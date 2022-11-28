import Router from "koa-router";

import accountProvisioner from "@server/commands/accountProvisioner";
import errorHandling from "@server/middlewares/errorHandling";
import { signIn } from "@server/utils/authentication";

const router = new Router();
const enabled = !!process.env.INSECURE_LOCAL_AUTH_ENABLED;

export const config = {
  name: "Local",
  enabled,
};

if (enabled) {
  router.get("local", errorHandling(), async (ctx) => {
    const { user, team, isNewTeam, isNewUser } = await accountProvisioner({
      ip: "127.0.0.1",
      team: {
        // https://github.com/outline/outline/pull/2388#discussion_r681120223
        name: "Wiki",
        domain: "localhost",
        subdomain: "local",
      },
      user: {
        name: "Local User",
        email: "user@example.com",
        avatarUrl: "",
        // Claim name can be overriden using an env variable.
        // Default is 'preferred_username' as per OIDC spec.
        username: "localuser",
      },
      authenticationProvider: {
        name: "local",
        providerId: "local",
      },
      authentication: {
        providerId: "local",
        scopes: ["local"],
      },
    });
    await signIn(ctx, user, team, "local", isNewUser, isNewTeam);
  });
}

export default router;
