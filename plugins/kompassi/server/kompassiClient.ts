import { InternalError } from "@server/errors";
import OAuthClient from "@server/utils/oauth";
import env from "./env";

/**
 * OAuth client for Kompassi, used by core to refresh and validate the access
 * tokens stored on UserAuthentication rows. Endpoints come from OIDC
 * discovery, so constructing one before discovery completes is an error.
 */
export default class KompassiClient extends OAuthClient {
  endpoints: { authorize: string; token: string; userinfo: string };

  constructor() {
    if (!env.KOMPASSI_TOKEN_URI || !env.KOMPASSI_USERINFO_URI) {
      throw InternalError(
        "Kompassi OIDC discovery has not completed yet, cannot create client."
      );
    }
    super(env.KOMPASSI_CLIENT_ID!, env.KOMPASSI_CLIENT_SECRET!);
    this.endpoints = {
      authorize: "",
      token: env.KOMPASSI_TOKEN_URI,
      userinfo: env.KOMPASSI_USERINFO_URI,
    };
  }
}
