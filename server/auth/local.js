// @flow
import Router from 'koa-router';
import addMonths from 'date-fns/add_months';
import { User, Team, Event } from '../models';

const router = new Router();

if (process.env.LOCAL_AUTH_ENABLED) {
  router.get('local', async ctx => {
    const [team, isFirstUser] = await Team.findOrCreate({
      where: {
        name: 'Local',
      },
    });

    const [user, isFirstSignin] = await User.findOrCreate({
      where: {
        service: 'local',
        serviceId: 'admin',
        teamId: team.id,
      },
      defaults: {
        name: 'admin',
        email: 'admin@example.com',
        isAdmin: isFirstUser,
      },
    });

    if (isFirstUser) {
      await team.provisionFirstCollection(user.id);
      // await team.provisionSubdomain(data.team.domain);
    }

    if (isFirstSignin) {
      await Event.create({
        name: "users.create",
        actorId: user.id,
        userId: user.id,
        teamId: team.id,
        data: {
          name: user.name,
          service: "slack",
        },
        ip: ctx.request.ip,
      });
    }

    // not awaiting the promise here so that the request is not blocked
    user.updateSignedIn(ctx.request.ip);

    ctx.cookies.set('lastSignedIn', 'local', {
      httpOnly: false,
      expires: new Date('2100'),
    });
    ctx.cookies.set('accessToken', user.getJwtToken(), {
      httpOnly: false,
      expires: addMonths(new Date(), 1),
    });

    ctx.redirect('/');
  });
}

export default router;
