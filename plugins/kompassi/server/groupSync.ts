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
 *
 * Only the groups named in KOMPASSI_ACCESS_GROUPS and KOMPASSI_ADMIN_GROUPS
 * are reported. A Kompassi account belongs to dozens of groups from unrelated
 * events, and the legacy provider mirrored only these two lists, so the
 * existing groups (and the collection permissions on them) are exactly this
 * set.
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

    const mirrored = new Set([
      ...env.KOMPASSI_ACCESS_GROUPS,
      ...env.KOMPASSI_ADMIN_GROUPS,
    ]);

    return (groupNames ?? [])
      .filter((name) => mirrored.has(name))
      .map((name) => ({ id: name, name }));
  }
}
