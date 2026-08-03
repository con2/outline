import { get } from "es-toolkit/compat";
import type { AuthenticationProviderSettings } from "@shared/types";
import { InternalError } from "@server/errors";
import { request } from "@server/utils/passport";
import type {
  ExternalGroupData,
  GroupSyncProvider,
} from "@server/utils/GroupSyncProvider";
import env from "./env";

/**
 * Syncs Outline group membership from the `groups` claim Kompassi's OIDC
 * provider embeds in its userinfo response (a flat list of Kompassi group
 * names, unconditional on granted scope). See
 * `kompassi/api_v2/custom_oauth2_validator.py` in the Kompassi codebase.
 */
export class KompassiGroupSyncProvider implements GroupSyncProvider {
  public useGroupClaim = true;

  public async fetchUserGroups(
    accessToken: string,
    settings: AuthenticationProviderSettings
  ): Promise<ExternalGroupData[]> {
    if (!env.KOMPASSI_USERINFO_URI) {
      throw InternalError(
        "Kompassi OIDC discovery has not completed yet, cannot sync groups."
      );
    }

    const claims = await request<Record<string, unknown>>(
      "GET",
      env.KOMPASSI_USERINFO_URI,
      accessToken
    );
    const groupNames = get(claims, settings.groupClaim || "groups") as
      | string[]
      | undefined;

    return (groupNames ?? []).map((name) => ({ id: name, name }));
  }
}
