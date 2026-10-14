import {
  AuthenticationProvider,
  ExternalGroup,
  Group,
  GroupUser,
} from "@server/models";
import { buildGroup, buildUser } from "@server/test/factories";
import env from "../env";
import { syncGroups } from "./kompassiRouter";

async function setup() {
  const user = await buildUser();
  const team = await user.$get("team");
  const authenticationProvider = (await AuthenticationProvider.findOne({
    where: { teamId: user.teamId },
  }))!;
  await authenticationProvider.update({ name: "kompassi" });

  // Legacy groups, linked to the provider the way the con2 migration does.
  const linkLegacyGroup = async (name: string) => {
    const group = await buildGroup({ teamId: user.teamId, name });
    await ExternalGroup.create({
      authenticationProviderId: authenticationProvider.id,
      externalId: name,
      name,
      groupId: group.id,
      teamId: user.teamId,
    });
    return group;
  };
  const staff = await linkLegacyGroup("staff");
  const former = await linkLegacyGroup("former");
  await GroupUser.create({
    groupId: former.id,
    userId: user.id,
    createdById: user.id,
  });

  env.KOMPASSI_ACCESS_GROUPS = ["staff", "former"];
  env.KOMPASSI_ADMIN_GROUPS = ["admins"];

  return { user, team: team!, staff, former };
}

describe("syncGroups", () => {
  it("mirrors only the access and admin groups the user is in", async () => {
    const { user, team, staff, former } = await setup();

    await syncGroups("127.0.0.1", user, team, [
      "staff",
      "admins",
      "unrelated-event-2027",
    ]);

    const memberOf = (
      await GroupUser.findAll({
        where: { userId: user.id },
        include: [{ model: Group, as: "group", required: true }],
      })
    )
      .map((gu) => gu.group.name)
      .sort();
    expect(memberOf).toEqual(["admins", "staff"]);

    // The legacy group was reused rather than duplicated.
    expect(
      await Group.count({ where: { teamId: team.id, name: "staff" } })
    ).toBe(1);
    expect(
      await GroupUser.count({ where: { groupId: staff.id, userId: user.id } })
    ).toBe(1);
    expect(
      await GroupUser.count({ where: { groupId: former.id, userId: user.id } })
    ).toBe(0);
    expect(
      await Group.count({
        where: { teamId: team.id, name: "unrelated-event-2027" },
      })
    ).toBe(0);
  });
});
