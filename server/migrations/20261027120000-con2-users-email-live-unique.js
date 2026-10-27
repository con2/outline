"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Some con2 databases predate 20170712055148-non-unique-email and still carry the
    // original constraint; it is replaced by the partial index below on every site.
    await queryInterface.sequelize.query(
      'ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_email_key";'
    );

    // Two live accounts must never share an email: the OIDC provisioner overwrites the
    // matched account's email with the provider's, so a wrong match must fail loudly
    // rather than silently merge accounts. Deleted rows are excluded so a removed user
    // can sign up again.
    await queryInterface.sequelize.query(
      `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "users_email_live_uk"
        ON "users" ("email") WHERE "deletedAt" IS NULL;`
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      'DROP INDEX CONCURRENTLY IF EXISTS "users_email_live_uk";'
    );
  },
};
