import { IsOptional, IsUrl } from "class-validator";
import { Environment } from "@server/env";
import environment from "@server/utils/environment";
import { CannotUseWithout } from "@server/utils/validators";

class KompassiPluginEnvironment extends Environment {
  /**
   * Kompassi OIDC client credentials, issued via the Kompassi admin for this
   * Outline instance.
   */
  @IsOptional()
  @CannotUseWithout("KOMPASSI_CLIENT_SECRET")
  public KOMPASSI_CLIENT_ID = this.toOptionalString(
    environment.KOMPASSI_CLIENT_ID
  );

  @IsOptional()
  @CannotUseWithout("KOMPASSI_CLIENT_ID")
  public KOMPASSI_CLIENT_SECRET = this.toOptionalString(
    environment.KOMPASSI_CLIENT_SECRET
  );

  /**
   * The base URL of the Kompassi instance to authenticate against, used to
   * discover its OIDC endpoints (at `/oidc/.well-known/openid-configuration`).
   */
  @IsUrl({ require_tld: false, allow_underscores: true })
  public KOMPASSI_BASE_URL =
    environment.KOMPASSI_BASE_URL ?? "https://kompassi.eu";

  /**
   * The Kompassi team/organization name this instance belongs to. Used as the
   * stable authentication provider identifier and default team display name.
   */
  public KOMPASSI_TEAM_NAME = environment.KOMPASSI_TEAM_NAME ?? "Con2";

  /**
   * A space separated list of Kompassi group names. Sign-in is rejected
   * unless the user is a member of at least one of these groups. Leave empty
   * to allow any authenticated Kompassi account to sign in.
   */
  public KOMPASSI_ACCESS_GROUPS = this.toGroupList(
    environment.KOMPASSI_ACCESS_GROUPS
  );

  /**
   * A space separated list of Kompassi group names. Members of any of these
   * groups are granted the Outline admin role, and have it revoked if they
   * stop being a member, on every sign-in.
   */
  public KOMPASSI_ADMIN_GROUPS = this.toGroupList(
    environment.KOMPASSI_ADMIN_GROUPS
  );

  /**
   * The Kompassi OIDC userinfo endpoint, discovered automatically on boot
   * from `KOMPASSI_BASE_URL`. Not intended to be set manually.
   */
  public KOMPASSI_USERINFO_URI: string | undefined;

  private toGroupList(value: string | undefined): string[] {
    return value ? value.split(/\s+/).filter(Boolean) : [];
  }
}

export default new KompassiPluginEnvironment();
