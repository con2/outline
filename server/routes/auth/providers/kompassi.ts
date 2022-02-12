import crypto from "crypto";

import fetch from "fetch-with-proxy";
import Router from "koa-router";

import { Op } from "sequelize";
import accountProvisioner from "@server/commands/accountProvisioner";
import errorHandling from "@server/middlewares/errorHandling";
import methodOverride from "@server/middlewares/methodOverride";
import { Group, GroupUser } from "@server/models";
import { signIn } from "@server/utils/authentication";
import { assertPresent } from "@server/validation";

const router = new Router();
router.use(methodOverride());

const baseUrl = process.env.KOMPASSI_BASE_URL || "https://kompassi.eu";
const clientId = process.env.KOMPASSI_CLIENT_ID || "";
const clientSecret = process.env.KOMPASSI_CLIENT_SECRET || "";
const accessGroups = (process.env.KOMPASSI_ACCESS_GROUPS || "").split(/\s+/);
const adminGroups = (process.env.KOMPASSI_ADMIN_GROUPS || "").split(/\s+/);
const teamName = process.env.KOMPASSI_TEAM_NAME || "Con2";
const tileyBaseUrl = "https://tiley.herokuapp.com/avatar";
const redirectUri = `${process.env.URL}/auth/kompassi.callback`;
const scope = "read";
const providerName = "kompassi";
const enabled = !!clientId;

export const config = {
  name: "Kompassi",
  enabled,
};

function getAuthUrl(): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    // state: "TODO",
  });
  return `${baseUrl}/oauth2/authorize?${params.toString()}`;
}

interface Token {
  access_token: string;
  refresh_token: string;
}

async function getToken(code: string): Promise<Token> {
  const params = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });
  const body = params.toString();
  const url = `${baseUrl}/oauth2/token`;
  const headers = {
    // authorization: `Basic ${basicAuth}`,
    accept: "application/json",
    "content-type": "application/x-www-form-urlencoded",
  };

  // console.log("getToken", { url, body, headers });

  const response = await fetch(url, { method: "POST", body, headers });
  return response.json();
}

interface Profile {
  id: number;
  first_name: string;
  surname: string;
  full_name: string;
  groups: string[];
  email: string;
  username: string;
}

async function getProfile(accessToken: string): Promise<Profile> {
  const url = `${baseUrl}/api/v2/people/me`;

  const headers = { authorization: `Bearer ${accessToken}` };

  const response = await fetch(url, { headers });
  return response.json();
}

function getHash(data: string) {
  const hash = crypto.createHash("sha256");
  hash.update(data);
  return hash.digest("hex");
}

if (enabled) {
  router.get("kompassi", async (ctx) => {
    ctx.redirect(getAuthUrl());
  });

  // signin callback from Google
  router.get("kompassi.callback", errorHandling(), async (ctx) => {
    const { code } = ctx.request.query;
    assertPresent(code, "code is required");
    const tokens = await getToken("" + code);
    // console.log("kompassi.callback", "tokens", tokens);

    const profile = await getProfile(tokens.access_token);
    // console.log("kompassi.callback", "profile", profile);

    const teamHash = getHash(teamName);
    const teamAvatarUrl = `${tileyBaseUrl}/${teamHash}/${teamName[0]}.png`;

    const initials = `${profile.first_name[0]}${profile.surname[0]}`;
    const userHash = getHash(profile.full_name);
    const userAvatarUrl = `${tileyBaseUrl}/${userHash}/${initials}.png`;

    const groupNames: string[] = profile.groups.filter(
      (groupName) =>
        accessGroups.includes(groupName) || adminGroups.includes(groupName)
    );
    if (!groupNames.length) {
      // User not member of any group that would grant access
      ctx.redirect(`${process.env.URL}?notice=auth-error`);
      return;
    }
    const isAdmin = groupNames.some((groupName) =>
      adminGroups.includes(groupName)
    );

    const { user, team, isNewUser, isNewTeam } = await accountProvisioner({
      ip: ctx.request.ip,
      team: {
        name: teamName,
        domain: "",
        subdomain: "",
        avatarUrl: teamAvatarUrl,
      },
      user: {
        name: profile.full_name,
        email: profile.email,
        avatarUrl: userAvatarUrl,
      },
      authenticationProvider: {
        name: providerName,
        providerId: teamName,
      },
      authentication: {
        providerId: "" + profile.id,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        scopes: scope.split(/\s+/),
      },
    });

    // update adminship
    if (user.isAdmin !== isAdmin) {
      user.isAdmin = isAdmin;
      await user.save();
    }

    // update group membership
    const groupIds: string[] = [];
    for (const groupName of groupNames) {
      // Ensure the groups exist that the user should be member of per Kompassi
      const [group] = await Group.findOrCreate({
        where: {
          teamId: team.id,
          name: groupName,
        },
        defaults: {
          createdById: user.id,
        },
      });

      groupIds.push(group.id);

      // Ensure membership
      await GroupUser.findOrCreate({
        where: {
          userId: user.id,
          groupId: group.id,
        },
        defaults: {
          createdById: user.id,
        },
      });
    }

    // Delete group memberships that are no longer valid per Kompassi
    // NOTE: Not scoped to team, would also delete memberships of other teams
    // But self hosted Outline is single team only so this is fine.
    await GroupUser.destroy({
      where: {
        userId: user.id,
        groupId: {
          [Op.notIn]: groupIds,
        },
      },
    });

    // set cookies on response and redirect to team subdomain
    await signIn(ctx, user, team, "local", isNewUser, isNewTeam);
  });
}

export default router;
