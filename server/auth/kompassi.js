// @flow
import Sequelize from "sequelize";
import crypto from "crypto";
import Router from "koa-router";
import fetch from "isomorphic-fetch";

import { User, Team, Event } from "../models";
import auth from "../middlewares/authentication";

const Op = Sequelize.Op;

const router = new Router();
const baseUrl = process.env.KOMPASSI_BASE_URL;
const clientId = process.env.KOMPASSI_CLIENT_ID;
const clientSecret = process.env.KOMPASSI_CLIENT_SECRET;
const tileyBaseUrl = "https://tiley.herokuapp.com/avatar";
const redirectUri = `${process.env.URL}/auth/kompassi.callback`;

function getAuthUrl() {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "read",
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
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64"
  );

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
router.get("kompassi", async ctx => {
  ctx.redirect(getAuthUrl());
});

// signin callback from Google
router.get("kompassi.callback", auth({ required: false }), async ctx => {
  const { code } = ctx.request.query;
  ctx.assertPresent(code, "code is required");
  const tokens = await getToken(code);
  console.log("kompassi.callback", "tokens", tokens);

  const profile = await getProfile(tokens.access_token);
  console.log("kompassi.callback", "profile", profile);

  const teamName = "Con2"; // TODO
  const teamHash = getHash(teamName);

  const teamAvatarUrl = `${tileyBaseUrl}/${teamHash}/C2.png`; // TODO

  const initials = `${profile.first_name[0]}${profile.surname[0]}`;
  const userHash = getHash(profile.full_name);
  const userAvatarUrl = `${tileyBaseUrl}/${userHash}/${initials}.png`;

  const [team, isFirstUser] = await Team.findOrCreate({
    where: {
      name: teamName,
    },
    defaults: {
      avatarUrl: teamAvatarUrl,
    },
  });

  try {
    const [user, isFirstSignin] = await User.findOrCreate({
      where: {
        [Op.or]: [
          {
            service: "kompassi",
            serviceId: "" + profile.id,
          },
          {
            service: { [Op.eq]: null },
            email: profile.email,
          },
        ],
        teamId: team.id,
      },
      defaults: {
        service: "kompassi",
        serviceId: "" + profile.id,
        name: profile.full_name,
        email: profile.email,
        isAdmin: isFirstUser,
        avatarUrl: userAvatarUrl,
      },
    });

    // update the user with fresh details if they just accepted an invite
    if (!user.serviceId || !user.service) {
      await user.update({
        service: "kompassi",
        serviceId: profile.id,
        avatarUrl: userAvatarUrl,
      });
    }

    // update email address if it's changed in Kompassi
    if (!isFirstSignin && profile.email !== user.email) {
      await user.update({ email: profile.email });
    }

    if (isFirstUser) {
      await team.provisionFirstCollection(user.id);
      await team.provisionSubdomain(teamName.toLowerCase()); // FIXME
    }

    if (isFirstSignin) {
      await Event.create({
        name: "users.create",
        actorId: user.id,
        userId: user.id,
        teamId: team.id,
        data: {
          name: user.name,
          service: "kompassi",
        },
        ip: ctx.request.ip,
      });
    }

    // set cookies on response and redirect to team subdomain
    ctx.signIn(user, team, "kompassi", isFirstSignin);
  } catch (err) {
    if (err instanceof Sequelize.UniqueConstraintError) {
      const exists = await User.findOne({
        where: {
          service: "email",
          email: profile.email,
          teamId: team.id,
        },
      });

      if (exists) {
        ctx.redirect(`${team.url}?notice=email-auth-required`);
      } else {
        ctx.redirect(`${team.url}?notice=auth-error`);
      }

      return;
    }

    throw err;
  }
});

export default router;
