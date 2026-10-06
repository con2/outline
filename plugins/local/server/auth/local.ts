import type Router from "koa-router";
import { Client } from "@shared/types";
import accountProvisioner from "@server/commands/accountProvisioner";
import { createContext } from "@server/context";
import { signIn } from "@server/utils/authentication";
import config from "../../plugin.json";

/**
 * Mounts an instant, passwordless sign-in route for local development. Never
 * enabled unless `INSECURE_LOCAL_AUTH_ENABLED` is explicitly set.
 *
 * @param router the router to mount the local authentication route on.
 */
export function createLocalRouter(router: Router): void {
  router.get(config.id, async (ctx) => {
    const context = createContext({ ip: ctx.ip });
    const result = await accountProvisioner(context, {
      team: {
        // https://github.com/outline/outline/pull/2388#discussion_r681120223
        name: "Wiki",
        domain: "localhost",
        subdomain: "local",
      },
      user: {
        name: "Local User",
        email: "user@example.com",
        emailVerified: true,
      },
      authenticationProvider: {
        name: config.id,
        providerId: config.id,
      },
      authentication: {
        providerId: config.id,
        scopes: [config.id],
      },
    });

    await signIn(ctx, config.id, { ...result, client: Client.Web });
  });
}
