// @flow
import crypto from "crypto";
import fetch from "isomorphic-fetch";
import Router from "koa-router";
import Sequelize from "sequelize";

import accountProvisioner from "../commands/accountProvisioner";
import auth from "../middlewares/authentication";
import { Group, GroupUser } from "../models";

const Op = Sequelize.Op;

const router = new Router();
const baseUrl = process.env.KOMPASSI_BASE_URL || "https://kompassi.eu";
const clientId = process.env.KOMPASSI_CLIENT_ID || "";
const clientSecret = process.env.KOMPASSI_CLIENT_SECRET || "";
const accessGroups = (process.env.KOMPASSI_ACCESS_GROUPS || "").split(/\s+/);
const adminGroups = (process.env.KOMPASSI_ADMIN_GROUPS || "").split(/\s+/);
const teamName = process.env.KOMPASSI_TEAM_NAME || "Con2";
const tileyBaseUrl = "https://tiley.herokuapp.com/avatar";
const redirectUri = `${process.env.URL}/auth/kompassi.callback`;
const scope = "read";

function getAuthUrl() {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    // state: "TODO",
  });
  return `${baseUrl}/oauth2/authorize?${params.toString()}`;
}

async function getToken(code: string) {
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

  console.log("getToken", { url, body, headers });

  const response = await fetch(url, { method: "POST", body, headers });
  return response.json();
}

async function getProfile(accessToken: string) {
  const url = `${baseUrl}/api/v2/people/me`;

  const headers = new Headers();
  headers.append("authorization", `Bearer ${accessToken}`);

  const response = await fetch(url, { headers });
  return response.json();
}

function getHash(data: string) {
  const hash = crypto.createHash("sha256");
  hash.update(data);
  return hash.digest("hex");
}

// start the oauth process and redirect user to Google
router.get("kompassi", async (ctx) => {
  ctx.redirect(getAuthUrl());
});

// signin callback from Google
router.get("kompassi.callback", auth({ required: false }), async (ctx) => {
  const { code } = ctx.request.query;
  ctx.assertPresent(code, "code is required");
  const tokens = await getToken(code);
  console.log("kompassi.callback", "tokens", tokens);

  const profile = await getProfile(tokens.access_token);
  console.log("kompassi.callback", "profile", profile);

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
    return void ctx.redirect(`${process.env.URL}?notice=auth-error`);
  }
  const isAdmin = groupNames.some((groupName) =>
    adminGroups.includes(groupName)
  );

  const result = await accountProvisioner({
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
      name: "kompassi",
      providerId: process.env.KOMPASSI_TEAM_NAME,
    },
    authentication: {
      providerId: "" + profile.id,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      scopes: scope.split(/\s+/),
    },
  });

  // update adminship
  const { user, team, isNewUser } = result;
  user.isAdmin = isAdmin;
  await user.save();

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
      [Op.not]: {
        groupId: groupIds,
      },
    },
  });

  // set cookies on response and redirect to team subdomain
  ctx.signIn(user, team, "kompassi", isNewUser);
});

export const config = {
  name: "Kompassi",
  enabled: !!clientId,
};

export default router;
