"use strict";

// CON2: the legacy Kompassi sign-in provider mirrored Kompassi groups into
// plain Outline groups matched by name. Core group sync matches by
// external_groups rows instead and would create a duplicate of every one of
// them on the first synced sign-in, leaving collection permissions on the old
// copies. Link each existing group to the Kompassi provider under its name,
// which is also the id the kompassi plugin's GroupSyncProvider reports.
module.exports = {
  async up(queryInterface) {
    return queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        INSERT INTO external_groups
          (id, "externalId", name, "groupId", "authenticationProviderId", "teamId", "createdAt", "updatedAt")
        SELECT gen_random_uuid(), g.name, g.name, g.id, ap.id, g."teamId", now(), now()
        FROM groups g
        JOIN authentication_providers ap
          ON ap."teamId" = g."teamId" AND ap.name = 'kompassi'
        WHERE g."externalId" IS NULL
          AND g."deletedAt" IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM external_groups eg
            WHERE eg."authenticationProviderId" = ap.id AND eg."externalId" = g.name
          )
        `,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `
        UPDATE groups g
        SET "externalId" = eg."externalId"
        FROM external_groups eg
        WHERE eg."groupId" = g.id AND g."externalId" IS NULL
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    return queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        UPDATE groups g
        SET "externalId" = NULL
        FROM external_groups eg
        JOIN authentication_providers ap ON ap.id = eg."authenticationProviderId"
        WHERE eg."groupId" = g.id AND ap.name = 'kompassi' AND eg."lastSyncedAt" IS NULL
        `,
        { transaction }
      );
      await queryInterface.sequelize.query(
        `
        DELETE FROM external_groups eg
        USING authentication_providers ap
        WHERE ap.id = eg."authenticationProviderId" AND ap.name = 'kompassi' AND eg."lastSyncedAt" IS NULL
        `,
        { transaction }
      );
    });
  },
};
