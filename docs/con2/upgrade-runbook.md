# Runbook: upgrading con2's Outline from v0.67.0 to upstream main

Branch `con2` runs in production: upstream v0.67.0 (January 2023) plus 70 fork commits. Branch
`con2-next` is the fork recreated on upstream `main` (v1.10.1 plus 11 commits, rebased
2026-10-01): one commit porting the con2 pieces (`plugins/kompassi`, `plugins/local`,
`Dockerfile.con2`, `kubernetes/`, the Attachment `isPrivate` override), the two group-list
commits made on `con2` after the fork was recreated, and two deployment fixes. `yarn tsc` and
`oxlint --type-aware` pass on it; it has never run against a real Kompassi login or a real
cluster.

CI (`.github/workflows/con2.yaml`) builds on every push to `con2` and deploys the five sites in one
job. Everything in this runbook that is not "push to `con2`" is a manual step.

| Site | Namespace | Hostname | Database on siilo | Minio bucket | Redis db |
|---|---|---|---|---|---|
| con2 | `outline` | outline.con2.fi | `outline` | `outline` | 11 |
| Tracon | `outline-tracon` | wiki.tracon.fi | `outlinetracon` | `outlinetracon` | 12 |
| Kuplii | `outline-kuplii` | wiki.tamperekuplii.fi | `outlinekuplii` | `outlinekuplii` | 14 |
| Ropecon | `outline-ropecon` | wiki.ropecon.fi | `outlineropecon` | `outlineropecon` | 6 |
| Kotae | `outline-kotae` | wiki.kotae.fi | `outlinekotae` | `outlinekotae` | 8 |

## What the upgrade does to the data

- 192 schema migrations run between v0.67.0 and the new head. The `setup` init container runs
  them (`node build/server/scripts/checkMigrations.js`, under a Redis lock) before the web
  container starts; the web container runs the same check again on boot and finds nothing to do.
  A failed migration fails the rollout and the old ReplicaSet keeps serving.
- Four migrations create PostgreSQL extensions: `uuid-ossp`, `pg_trgm`, `unaccent`, `btree_gin`.
  All four are trusted extensions since PostgreSQL 13, so the application role can create them
  as long as it owns the database. siilo runs PostgreSQL 17. Pre-creating them as a superuser
  (step 3) removes the only plausible migration failure.
- Four data-migration scripts are invoked by migrations themselves (emoji in titles, API key
  hashing, collection index collisions). Two more are worth running by hand afterwards but are
  not required: `20231119000000-backfill-document-content.js` and
  `20231119000000-backfill-revision-content.js` convert the stored Y.js `state` into the JSON
  `content` column. Documents with `content IS NULL` are still served from `state`
  (`server/models/Document.ts`, the `CASE WHEN document.content IS NULL` scope), so the site works
  without the backfill; it just does the conversion lazily and search/exports are slower until
  then.
- Authentication continuity: the `authentication_providers` row on each site is
  `(name = kompassi, providerId = <team name>)`. The plugin keeps `name = "kompassi"` and uses
  `KOMPASSI_TEAM_NAME` as `providerId`, so the row reattaches as long as the team name in the vars
  file equals the one in the database (`Con2`, `Tracon`, `Tampere Kuplii`, `Ropecon`, `Kotae`).
  Existing users relink by **email**, not by provider id: the legacy plugin stored Kompassi
  Person ids, OIDC `sub` is the Kompassi User pk. The plugin forces `emailVerified = true` so that
  an email match links instead of being rejected. A person whose Kompassi email differs from the
  one Outline has on file gets a new, empty account; the old one has to be merged or deleted by
  an admin.
- Group sync: Outline's core group-sync framework replaces the legacy plugin's manual
  `GroupUser` mirroring. It is off until an admin enables it per site (step 5). Core matches
  groups by `external_groups` rows, not by name, so a con2 migration
  (`20261001120000-con2-link-legacy-kompassi-groups`) links every existing group of a team with a
  `kompassi` provider under its own name before the first sync; without it each legacy group
  would get a synced duplicate and the collection permissions would stay on the old copy.
- The `teams` row predates 2024 and an `authentication_providers` row exists, so the startup
  check for the 2021 authentication data migration passes.

## 1. Test against a production dump (local)

Done on 2026-10-01 for the con2 site: `outline-20261001.sql` (16 MB, 307 documents, 188
attachments, 212 users) is mounted into the compose postgres and `.env` (git-ignored) is written
for it. Repeat for another site by swapping the dump and `KOMPASSI_*` values.

```sh
docker compose up -d
yarn install
yarn build
yarn start            # NODE_ENV=production from .env; .env.development is not layered on top
```

To run it in development mode instead (`yarn dev`, debugger, hot reload), note that the committed
`.env.development` overrides `.env` with its own `URL` and a database on `127.0.0.1:5432`. A
git-ignored `.env.local` is loaded after it in development mode and wins; put `URL`,
`DATABASE_URL` and `REDIS_URL` there.

Checks, in order:

1. The startup log shows `Running migrations…` and the server ends up listening. Then, with
   `psql postgres://user:pass@127.0.0.1:5432/outline`:

   ```sql
   select extname from pg_extension;                     -- uuid-ossp, pg_trgm, unaccent, btree_gin
   select count(*) from documents where content is null;  -- candidates for the backfill script
   ```

2. Sign in at http://localhost:3000 with Kompassi. If the callback returns 500 with
   `error:1C800064:Provider routines::bad decrypt` from `User.getSessionToken`, the dump's rows are
   encrypted with the production `SECRET_KEY` and `.env` has a different one: paste the production
   key into `.env`, or run `node build/server/scripts/reset-encrypted-data.js` to regenerate every
   user's JWT secret under the local key. Neither applies in production, which keeps its key.
   The Kompassi Application must list
   `http://localhost:3000/auth/kompassi.callback` as a redirect URI (step 2). Confirm you land in
   the existing account (same documents, same collections), not a fresh one.
3. Open documents with images and attachments. In this setup `FILE_STORAGE=local`, so the
   `/api/attachments.redirect` links 404; what you are checking is that the editor renders the
   2023-era document content at all.
4. Settings → Security: enable group sync for the Kompassi provider, sign out and in again, and
   compare Settings → Groups against your Kompassi groups. Expect exactly the groups named in
   `KOMPASSI_ACCESS_GROUPS` and `KOMPASSI_ADMIN_GROUPS` that you belong to, each shown as synced,
   and no duplicates: migration `20261001120000-con2-link-legacy-kompassi-groups` links the
   legacy name-matched groups to the provider, and the plugin reports only those two lists. Two
   `admins` groups (one plain, one synced) means the database was synced before that migration
   existed; reset it (`docker compose down -v`) and repeat.
5. Run the optional backfills and confirm they finish:

   ```sh
   node build/server/scripts/20231119000000-backfill-document-content.js
   node build/server/scripts/20231119000000-backfill-revision-content.js
   ```

6. Mail: `.env` has no `SMTP_HOST`, so nothing is sent. Production sends over port 25; see the
   SMTP note under step 5 before relying on notification mail.

To redo the test from a clean database: `docker compose down -v && docker compose up -d`.

## 2. Kompassi: OIDC Applications (manual, Kompassi admin)

Five legacy OAuth2 Applications exist in Kompassi (`/admin/oauth2_provider/application/`), one per
site, each with redirect URI `https://<hostname>/auth/kompassi.callback`. The new plugin uses the
same callback path, so the cheapest route is to edit each existing Application and keep its client
id and secret, which leaves the `outline` Secret in every namespace untouched:

- Algorithm: **RS256** (the plugin reads the id_token; `kompassi.eu` advertises RS256 and HS256).
- Client type: confidential. Authorization grant type: authorization code.
- Redirect URIs: `https://<hostname>/auth/kompassi.callback`, plus
  `http://localhost:3000/auth/kompassi.callback` on the one used for the local test (remove it
  afterwards).
- Scopes requested by the plugin: `openid profile email`. Groups come in the `groups` claim
  unconditionally.

If you create new Applications instead, update `kompassiClientId` and `kompassiClientSecret` in
Secret `outline` of that namespace before deploying.

Flipping an Application to RS256 does not break the running v0.67 site: the legacy flow never
looked at an id_token.

## 3. Cluster preparation (manual, once per site)

1. Backups. siilo has continuous Barman backups, but take an explicit dump per database so the
   rollback in step 6 is a known file, not a point-in-time recovery:

   ```sh
   for db in outline outlinetracon outlinekuplii outlineropecon outlinekotae; do
     pg_dump "postgres://<admin>@siilo.tracon.fi/$db?sslmode=verify-full" -Fc -f "$db-pre-upgrade.dump"
   done
   ```

2. Extensions, as a superuser on siilo:

   ```sh
   for db in outline outlinetracon outlinekuplii outlineropecon outlinekotae; do
     psql -d "$db" -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS unaccent; CREATE EXTENSION IF NOT EXISTS btree_gin;'
   done
   ```

3. Secrets. Nothing new is required. Confirm each namespace's `outline` Secret has
   `awsAccessKeyId`, `awsSecretAccessKey`, `kompassiClientId`, `kompassiClientSecret`,
   `secretKey`, `utilsSecretKey`, and the `postgres` Secret has `hostname`, `database`,
   `username`, `password`:

   ```sh
   for ns in outline outline-tracon outline-kuplii outline-ropecon outline-kotae; do
     kubectl -n $ns get secret outline postgres -o jsonpath='{range .items[*]}{.metadata.name}: {.data}{"\n"}{end}' | sed 's/:"[^"]*"/:…/g'
   done
   ```

4. Redis is `redis-ha` 8.10 (`infrastructure/kubernetes/redis-ha.values.yml`); the new version
   needs nothing beyond what 0.67 used. The database numbers stay.
5. Memory. The manifests set `WEB_CONCURRENCY=2` (upstream defaults to one web process per node
   CPU) and still declare no resource requests; watch `kubectl top pod` after the first rollout
   and add requests in the Helm chart (see the platform migration plan).

## 4. Cutover (git)

1. Keep the old branch reachable under a name that will not be force-pushed over:

   ```sh
   git tag con2-legacy origin/con2
   git push origin con2-legacy
   ```

2. Canary on con2.fi first. The deploy job deploys all five namespaces, so for the first push
   comment out the four non-con2 `emskaffolden -E … deploy` lines in
   `.github/workflows/con2.yaml` on `con2-next`, commit, and restore them in a follow-up commit
   once con2.fi is verified. (Alternative: leave the workflow alone and run
   `emskaffolden -E con2 -- deploy -n outline -a build.json` by hand with the `build.json`
   artifact from the build job.)
3. `con2` is the repository's default branch and `con2-next` shares no history with it, so this is
   a force-push, not a merge. Lift branch protection on `con2` if GitHub refuses:

   ```sh
   git push origin con2-next:con2 --force
   ```

4. Watch the rollout:

   ```sh
   kubectl -n outline get pods -w
   kubectl -n outline logs -f deploy/outline -c setup      # migrations
   kubectl -n outline logs -f deploy/outline -c outline
   curl -sH 'Host: outline.con2.fi' http://<pod-ip>:3000/_health
   ```

   The Deployment is a default rolling update, so the v0.67 pod keeps running while the new pod
   migrates the schema it is using. Expect errors from the old pod during those minutes;
   `kubectl -n outline scale deploy/outline --replicas=0` before the push avoids them at the cost
   of a few minutes of downtime instead.

5. Once con2.fi passes step 5, restore the four deploy lines and push again. The other four
   sites then roll out from one push.

## 5. After each site's rollout (manual)

1. Sign in with a Kompassi account in that site's admin group; confirm it is your existing
   account and that it has the admin role.
2. Settings → Security: enable group sync for the Kompassi provider. Sign out and in once so
   your own groups sync; other users sync on their next sign-in.
3. Attachments: open a document with an image (served via a signed Minio URL through
   `/api/attachments.redirect`), and upload a new one (browser presigned POST straight to Minio).
4. Optional backfills, from inside the pod. `kubectl exec` skips the image entrypoint, which is
   what derives `DATABASE_URL` from the `POSTGRES_*` variables, so every script run in the pod goes
   through `docker-entrypoint.sh`:

   ```sh
   kubectl -n outline exec deploy/outline -c outline -- /opt/outline/docker-entrypoint.sh node build/server/scripts/20231119000000-backfill-document-content.js
   kubectl -n outline exec deploy/outline -c outline -- /opt/outline/docker-entrypoint.sh node build/server/scripts/20231119000000-backfill-revision-content.js
   ```

5. SMTP. The sites send through `sr1.pahaip.fi` on port 25. Upstream's `SMTP_SECURE` now defaults
   to true (TLS on connect), which does not work on port 25. If the first notification mail
   fails with a TLS error in the logs, add `SMTP_SECURE=false` to `outline_environment` in
   `kubernetes/default.vars.yaml` (STARTTLS still happens when the server offers it).
6. Group-based collection access on con2.fi (`conikuvat-staff`, `larppikuvat-staff`) depends on
   the synced groups existing under the same names as before; check Settings → Groups shows them
   with members before anyone relies on them.

## 6. Rollback

Rolling back the application alone is not enough: the schema is migrated and v0.67 cannot run on
it. Per site:

1. `kubectl -n <ns> scale deploy/outline --replicas=0`.
2. Restore the dump from step 3 into the same database on siilo (drop and recreate the schema
   contents, do not use `pg_restore -C`). Attachments in Minio are untouched by the upgrade.
3. Redeploy the old code: `git push origin con2-legacy:con2 --force` rebuilds and deploys v0.67
   to all five namespaces, so restore every site that was upgraded, or deploy a single site by
   hand with emskaffolden as in step 4.2.
4. Kompassi Applications can stay on RS256; the legacy flow ignores it.

## Known gaps

- No deploy of `con2-next` has run anywhere yet; the Dockerfile chain
  (`Dockerfile.base` → `Dockerfile` → `Dockerfile.con2` via skaffold `requires`) is untested on
  the GitHub runner.
- The deployment still has no resource requests or limits and a single replica per site.
- The sites still run on siilo, Minio and Ingress; those moves are planned separately in
  `platform-migration-plan.md`.
