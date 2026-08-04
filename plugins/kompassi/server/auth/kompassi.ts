import Router from "koa-router";
import { toError } from "@shared/utils/error";
import Logger from "@server/logging/Logger";
import { fetchOIDCConfiguration } from "plugins/oidc/server/oidcDiscovery";
import env from "../env";
import { createKompassiRouter } from "./kompassiRouter";

const router = new Router();

/**
 * Discovers Kompassi's OIDC configuration from `KOMPASSI_BASE_URL` and mounts
 * the authentication routes once discovery completes. Kompassi is a single,
 * known identity provider, so unlike the generic `oidc` plugin no manual
 * endpoint configuration is supported here.
 */
const routerPromise: Promise<Router> = (async () => {
  try {
    const issuerUrl = `${env.KOMPASSI_BASE_URL}/oidc/`;
    Logger.debug("plugins", "Starting Kompassi OIDC configuration discovery");

    const oidcConfig = await fetchOIDCConfiguration(issuerUrl);
    env.KOMPASSI_USERINFO_URI = oidcConfig.userinfo_endpoint;

    createKompassiRouter(router, {
      authorizationURL: oidcConfig.authorization_endpoint,
      tokenURL: oidcConfig.token_endpoint,
      userInfoURL: oidcConfig.userinfo_endpoint,
      pkce: oidcConfig.code_challenge_methods_supported?.includes("S256"),
    });

    Logger.info("plugins", "Kompassi OIDC endpoints mounted after discovery", {
      issuer: oidcConfig.issuer,
    });

    return router;
  } catch (error) {
    Logger.fatal("Failed to discover Kompassi OIDC configuration", toError(error));
    throw error;
  }
})();

export default routerPromise;
