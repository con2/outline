import passport from "@outlinewiki/koa-passport";
import JWT from "jsonwebtoken";
import type { Request } from "koa";
import type Router from "koa-router";
import { toError } from "@shared/utils/error";
import { slugifyDomain } from "@shared/utils/domains";
import { parseEmail } from "@shared/utils/email";
import { isBase64Url } from "@shared/utils/urls";
import { UserRole } from "@shared/types";
import accountProvisioner from "@server/commands/accountProvisioner";
import { AuthenticationError, InvalidAuthenticationError } from "@server/errors";
import Logger from "@server/logging/Logger";
import passportMiddleware from "@server/middlewares/passport";
import type { User } from "@server/models";
import type { AuthenticationResult } from "@server/types";
import {
  StateStore,
  getTeamFromContext,
  getClientFromOAuthState,
  getUserFromOAuthState,
  request,
  startOAuthFlow,
  withProxyAgent,
} from "@server/utils/passport";
import { OIDCStrategy } from "plugins/oidc/server/auth/OIDCStrategy";
import { createContext } from "@server/context";
import config from "../../plugin.json";
import env from "../env";

export interface KompassiEndpoints {
  authorizationURL: string;
  tokenURL: string;
  userInfoURL: string;
  pkce?: boolean;
}

/**
 * The subset of claims Kompassi's OIDC provider is known to return, both from
 * its userinfo endpoint and embedded directly in the id_token. See
 * `kompassi/api_v2/custom_oauth2_validator.py` in the Kompassi codebase.
 */
interface KompassiClaims {
  sub?: string;
  email?: string;
  name?: string;
  picture?: string;
  groups?: string[];
}

const SCOPES = ["openid", "profile", "email"];

/**
 * Creates the Kompassi authentication routes and mounts them into the
 * provided router.
 *
 * Kompassi's OIDC provider embeds a `groups` claim directly in both the
 * id_token and userinfo response. This is used to gate sign-in to an
 * allow-listed set of groups and to grant/revoke the Outline admin role,
 * mirroring the access-control behaviour of the legacy custom Kompassi
 * integration this plugin replaces.
 *
 * @param router the router to mount the Kompassi authentication routes on.
 * @param endpoints the discovered Kompassi OIDC endpoints.
 */
export function createKompassiRouter(
  router: Router,
  endpoints: KompassiEndpoints
): void {
  passport.use(
    config.id,
    withProxyAgent(
      new OIDCStrategy(
        {
          authorizationURL: endpoints.authorizationURL,
          tokenURL: endpoints.tokenURL,
          clientID: env.KOMPASSI_CLIENT_ID!,
          clientSecret: env.KOMPASSI_CLIENT_SECRET!,
          callbackURL: `${env.URL}/auth/${config.id}.callback`,
          passReqToCallback: true,
          scope: SCOPES.join(" "),
          // @ts-expect-error custom state store
          store: new StateStore(endpoints.pkce),
          state: true,
          pkce: endpoints.pkce ?? false,
        },
        async function (
          req: Request,
          accessToken: string,
          refreshToken: string,
          params: { expires_in: number; id_token: string; scope?: string },
          _profile: unknown,
          done: (
            err: Error | null,
            user: User | null,
            result?: AuthenticationResult
          ) => void
        ) {
          const context = req.ctx;
          try {
            const profile = await request<KompassiClaims>(
              "GET",
              endpoints.userInfoURL,
              accessToken
            );

            const token = (() => {
              try {
                const decoded = JWT.decode(params.id_token);
                return decoded && typeof decoded === "object"
                  ? (decoded as KompassiClaims)
                  : {};
              } catch (err) {
                Logger.error("id_token decode threw error: ", toError(err));
                return {};
              }
            })();

            const email = profile.email ?? token.email ?? null;
            if (!email) {
              throw AuthenticationError(
                "An email field was not returned by Kompassi, but is required."
              );
            }

            const groups = profile.groups ?? token.groups ?? [];

            if (
              env.KOMPASSI_ACCESS_GROUPS.length > 0 &&
              !groups.some((group) => env.KOMPASSI_ACCESS_GROUPS.includes(group))
            ) {
              throw InvalidAuthenticationError(
                "Your Kompassi account is not a member of a group with access to this wiki."
              );
            }

            const isAdmin =
              env.KOMPASSI_ADMIN_GROUPS.length > 0 &&
              groups.some((group) => env.KOMPASSI_ADMIN_GROUPS.includes(group));

            const team = await getTeamFromContext(context);
            const client = getClientFromOAuthState(context);
            const user =
              context.state?.auth?.user ??
              (await getUserFromOAuthState(context));
            const { domain } = parseEmail(email);
            const subdomain = slugifyDomain(domain);

            const name = profile.name ?? token.name ?? email;
            const profileId = profile.sub ?? token.sub;
            if (!profileId) {
              throw AuthenticationError(
                "A user id (sub claim) was not returned by Kompassi, but is required."
              );
            }

            let avatarUrl = profile.picture;
            if (avatarUrl && isBase64Url(avatarUrl)) {
              avatarUrl = undefined;
            }

            const ctx = createContext({
              ip: context.ip,
              user,
              authType: context.state?.auth?.type,
            });
            const result = await accountProvisioner(ctx, {
              team: {
                teamId: team?.id,
                name: env.KOMPASSI_TEAM_NAME,
                domain,
                subdomain,
              },
              user: {
                name,
                email,
                // Kompassi is our own trusted internal identity provider, so
                // every account it returns is treated as having a verified
                // email. This also lets users who were previously provisioned
                // through the legacy custom Kompassi integration re-link by
                // email match, since their external provider id changes shape
                // between the legacy integration (a Kompassi Person id) and
                // this one (the `sub` claim, a Kompassi User id).
                emailVerified: true,
                avatarUrl,
              },
              authenticationProvider: {
                // Intentionally kept as "kompassi" (matching the legacy
                // integration's provider name) rather than "oidc", so the
                // existing AuthenticationProvider row for each team is reused
                // instead of orphaned.
                name: config.id,
                providerId: env.KOMPASSI_TEAM_NAME,
              },
              authentication: {
                providerId: profileId,
                accessToken,
                refreshToken,
                expiresIn: params.expires_in,
                scopes: params.scope ? params.scope.split(" ") : SCOPES,
              },
            });

            // Mirror the legacy integration's behaviour: admin access tracks
            // Kompassi admin-group membership on every sign-in, promoting and
            // demoting as membership changes. Skipped entirely when no admin
            // groups are configured, so as not to touch roles granted by hand.
            if (env.KOMPASSI_ADMIN_GROUPS.length > 0) {
              const currentlyAdmin = result.user.role === UserRole.Admin;
              if (isAdmin !== currentlyAdmin) {
                await result.user.update({
                  role: isAdmin ? UserRole.Admin : result.team.defaultUserRole,
                });
              }
            }

            return done(null, result.user, { ...result, client });
          } catch (err) {
            return done(toError(err), null);
          }
        }
      )
    )
  );

  router.get(config.id, startOAuthFlow, passport.authenticate(config.id));
  router.register(
    `${config.id}.callback`,
    ["get", "post"],
    passportMiddleware(config.id)
  );
}
