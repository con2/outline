# Plan: moving con2's Outline to Gateway API, Helm, CloudNativePG and Garage

Four changes to how the five Outline sites are deployed, all independent of the application
upgrade in `upgrade-runbook.md`, and all already done once for other con2 apps on qb. This plan
reuses those recipes; the file paths below point at them.

| Change                | From                                                            | To                                                       | Reference done elsewhere                                  |
| --------------------- | --------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------- |
| Routing               | `Ingress` (Traefik class) + per-Ingress cert-manager annotation | `Gateway` + `HTTPRoute`, cert-manager on the Gateway     | rallly-con2 `chart/`, edegal, larpit-fi                   |
| Templating and deploy | Emrichen `.in.yaml` via emskaffolden + skaffold                 | Helm chart in `chart/`, `helm upgrade --install` from CI | rallly-con2 `chart/` + `cicd.yaml`                        |
| Database              | siilo.tracon.fi (PostgreSQL 17, bare metal)                     | CloudNativePG cluster `postgres` on qb (PostgreSQL 18)   | `infrastructure/kubernetes/postgres/README.md`, larpit-fi |
| Attachments           | minio.con2.fi                                                   | garage.con2.fi                                           | kompassi media move (2026-09-29), edegal                  |

Recommended order, one change live and stable before the next starts (steps 1, 3 and 4 are done,
see their sections; only the Helm + Gateway API move remains):

1. Application upgrade (runbook). Everything below assumes the new code, mainly because the
   S3 client, upload method and env var names are the new ones.
2. Helm + Gateway API together, one chart change, mechanical across five namespaces. Doing this
   second means the data moves are recorded as values-file edits in git instead of as edits to
   Emrichen vars that are about to be deleted.
3. siilo → CloudNativePG, one site at a time. Three existing scripts, no application change.
4. Minio → Garage, one site at a time. Most application-specific of the four (CORS, ACL header,
   old URLs in document text) and the only one where the con2-specific `isPrivate` override
   matters, so it goes last with the others out of the way.

con2.fi is the canary for every step, as for the upgrade.

## 1. Emrichen/emskaffolden → Helm, with Gateway API

### Chart layout

`chart/` in this repository, modelled on rallly-con2's chart (one release per namespace, Gateway
per namespace, env inline, pre-existing out-of-band Secret):

```
chart/
  Chart.yaml                  appVersion = upstream Outline version
  values.yaml                 defaults + obviously bogus placeholders for `helm lint`
  values-con2.yaml            one per site, replaces kubernetes/<site>.vars.yaml
  values-tracon.yaml
  values-kuplii.yaml
  values-ropecon.yaml
  values-kotae.yaml
  templates/_helpers.tpl      labels, env list, probe
  templates/deployment.yaml   migration init container + outline container
  templates/service.yaml
  templates/gateway.yaml      cert-manager.io/cluster-issuer: letsencrypt-prod, TLS Secret tls-outline
  templates/httproutes.yaml   redirect-https on the http listener, app on https
  README.md                   prerequisites, upgrade, one-time cutover
```

Values per site are exactly what the vars files hold today: hostname, Kompassi team name and
group lists, SMTP from address, Redis db number, bucket name and endpoint, image tag. The
`postgres_managed`/`redis_managed` dev-only paths are dropped; local development uses
`docker-compose.yml`.

Deployment template, carried over from `kubernetes/outline/deployment.in.yaml` with the
additions the other charts got on Traefik: `preStop` sleep of 10 s and a matching
`terminationGracePeriodSeconds`, `maxUnavailable: 0`, `startupProbe` on `/_health` instead of a
long `initialDelaySeconds`, resource requests (start from `kubectl top pod` after the upgrade;
Outline with `WEB_CONCURRENCY=2` sits around 500 MiB to 1 GiB), `automountServiceAccountToken:
false`, `capabilities.drop: [ALL]`. The selector labels must stay
`app.kubernetes.io/part-of: outline, app.kubernetes.io/component: server, app.kubernetes.io/name:
outline`, because the existing Deployment is adopted, not recreated, and selectors are immutable.

Secrets stay out of band. The chart reads the existing `outline` and `postgres` Secrets by name
(`existingSecretName` pattern); the `postgres` Secret keeps its Django-shaped keys
(`hostname`, `database`, `username`, `password`) on purpose, because that is the shape
`infrastructure/kubernetes/postgres/update-secret.sh` knows how to rewrite in step 2. The
`docker-entrypoint.sh` that builds `DATABASE_URL` from `POSTGRES_*` therefore stays.

### Image build without skaffold

skaffold's `requires` chain (`Dockerfile.base` → `Dockerfile` → `Dockerfile.con2`) goes away with
emskaffolden. Replace it with a `docker-bake.hcl` at the repository root and
`docker/bake-action` in CI; bake expresses the same chain with `contexts`:

```hcl
group "default" { targets = ["con2"] }
target "base"     { dockerfile = "Dockerfile.base" }
target "upstream" { dockerfile = "Dockerfile"
                    contexts = { "outlinewiki/outline-base" = "target:base" } }
target "con2"     { dockerfile = "Dockerfile.con2"
                    contexts = { "upstream" = "target:upstream" }
                    args = { UPSTREAM_IMAGE = "upstream" }
                    tags = ["ghcr.io/con2/outline:${GIT_SHA}"] }
```

(`Dockerfile` defaults `BASE_IMAGE` to `outlinewiki/outline-base`, which is why that is the
context name; `Dockerfile.con2` takes `UPSTREAM_IMAGE` as a build arg.) The chart's image tag is
then passed as `--set image.tag=$GITHUB_SHA`. The build job keeps running on `ubuntu-latest` with
GHCR login; the deploy job on `qb-arc-runners` becomes five `helm upgrade --install` calls, one per
namespace, like rallly-con2's `cicd.yaml` but with `--set image.tag`.

### One-time cutover per namespace

The procedure in rallly-con2 `chart/README.md`, "One-time cutover from skaffold", applies
verbatim with the names changed; the memory of what bit on rallly and larpit is in it. Summary:

1. Label and annotate `deployment/outline` and `service/outline` with
   `app.kubernetes.io/managed-by=Helm`, `meta.helm.sh/release-name=outline`,
   `meta.helm.sh/release-namespace=<ns>`.
2. `helm template outline chart -f chart/values-<site>.yaml | kubectl -n <ns> diff
--server-side --force-conflicts -f -` and read it. Expect the new Gateway and HTTPRoutes,
   labels, resources, probes and security context; nothing in the env list should change.
3. `helm upgrade --install outline chart -n <ns> -f chart/values-<site>.yaml --wait
--force-conflicts`. Only this first install needs `--force-conflicts` (fields are owned by
   `kubectl-client-side-apply`).
4. Wait for `kubectl -n <ns> get certificate tls-outline` to be Ready. Until then the Ingress
   keeps serving with its own certificate. Then `kubectl -n <ns> delete ingress outline` and
   check the `ingress-letsencrypt` Certificate and Secret went with it.
5. Repeat for the other four namespaces, then switch `.github/workflows/con2.yaml` to the Helm
   deploy and delete `kubernetes/`, `skaffold.in.yaml` and the emskaffolden steps in the same
   commit.

Hostnames do not change, so no DNS or Kompassi redirect URI changes. The https redirect moves
from the `default-https-redirect@kubernetescrd` Middleware annotation to the `redirect-https`
HTTPRoute; it stays per-app and never at the entrypoint (cert-manager HTTP-01).

Env var housekeeping to do in the chart while every variable is being retyped anyway:
`FORCE_HTTPS=false` stays (TLS ends at the Gateway); `PROXY_HEADERS_TRUSTED` defaults to true,
which is right behind Traefik; add `SMTP_SECURE` per the runbook if port 25 needs it.

## 2. siilo → CloudNativePG

**Done 2026-10-01 for all five sites** with the three scripts below; no application or manifest
change was needed, since the `postgres` Secret carries the hostname. Remaining: after a few stable
days, take a manual CNPG backup and drop the five databases and roles on siilo (README step 5).


Recipe: `infrastructure/kubernetes/postgres/README.md`, "Migrating an app off siilo". Outline
needs nothing beyond it:

- The `postgres` Secret in each namespace is Django-shaped, so `update-secret.sh` recognises it
  as is. It rewrites `hostname` to `postgres-rw.postgres.svc.cluster.local` and `password` to the
  new role's; `database` and `username` keep the names chosen in `create-app-database.sh`, so
  use the existing names (`outline`, `outlinetracon`, …) as the app argument to keep the Secret's
  `database` key truthful.
- `PGSSLMODE=require` (from `postgres_ssl: true`) keeps working against the cluster's private
  CA, as documented there. Do not switch to `verify-full`.
- The four extensions are trusted and the role owns the database, so the schema restores with
  `pg_dump | pg_restore --no-owner --no-acl` as the script does. Check `\dx` in the new
  database afterwards.
- Outline has no read-replica support worth wiring; ignore `DATABASE_URL_REPLICA`.

Per site, in `infrastructure/kubernetes/postgres`:

```sh
./create-app-database.sh outlinetracon
kubectl -n outline-tracon scale deploy/outline --replicas=0
./migrate-database.sh outlinetracon outline-tracon postgres
./update-secret.sh outlinetracon outline-tracon postgres
kubectl -n outline-tracon scale deploy/outline --replicas=1
```

Outage is the dump/restore time (seconds to a minute for 16 MB). The collaboration server holds
document state in memory and Redis, so scale to zero rather than letting two versions write.
After a few stable days, back up and drop the database and role on siilo (README step 5). The
five Outline databases are a third of what is left on siilo
(`infrastructure/kubernetes/postgres/README.md` lists the rest).

## 3. Minio → Garage

**Done 2026-10-01 for all five sites**, ahead of the planned order, because the upgraded Outline's
download URLs failed against the 2020 Minio with `SignatureDoesNotMatch`. Remaining: delete the
five Minio buckets (`outline`, `outlinetracon`, `outlinekuplii`, `outlineropecon`,
`outlinekotae`) around 2026-10-15 once nobody has missed anything.


Per site: a bucket and a key on Garage, a copy, a Secret and values change, a CORS rule, then the
Minio bucket is deleted after a grace period. Recipe used for Kompassi production on 2026-09-29;
Garage specifics from `infrastructure/kubernetes/garage/README.md` and edegal `chart/README.md`.

What Outline does with the bucket, so the differences from Minio are known up front:

- Uploads are browser presigned **POST** forms (`AWS_S3_UPLOAD_METHOD=post`, the default). Garage
  implements PostObject and presigned URLs. The bucket needs a CORS rule allowing `POST` (and
  `GET`, `HEAD`) from the site's origin; Minio allowed everything by default, Garage allows
  nothing until `PutBucketCors` is called. edegal's `src/bin/s3-setup.ts` is the one-off script to
  copy, with `POST` added to `AllowedMethods`.
- Outline sends `x-amz-acl` on every upload when `AWS_S3_ACL` is set. Garage implements no ACLs.
  Set `aws_s3_acl: ""` in the site's vars (`AWS_S3_ACL` empty): `server/env.ts` then omits the
  header. This is also why the fork's `Attachment.isPrivate` override (every download
  is a signed URL) stays: it is what makes "no ACL" safe.
- Downloads are signed URLs through `/api/attachments.redirect?id=…`, built from
  `AWS_S3_UPLOAD_BUCKET_URL` plus the stored key at request time. Keys are relative
  (`uploads/<userId>/<uuid>/<name>`), so switching the endpoint re-points every existing
  attachment with no row changes.
- Documents written before Outline introduced the redirect endpoint can embed direct
  `https://minio.con2.fi/<bucket>/…` URLs in their text. On the con2 dump there are 26 mentions of
  the Minio hostname and none of them are attachment paths (they are documentation about Minio
  itself), so con2.fi needs no rewrite. Check each other site before its move:

  ```sql
  select count(*) from documents where text like '%minio.con2.fi/outlinetracon/%';
  select count(*) from revisions where text like '%minio.con2.fi/outlinetracon/%';
  ```

  If non-zero, either rewrite the text to `/api/attachments.redirect?id=…` by matching the key
  against `attachments.key`, or keep a hostname redirect `minio.con2.fi → garage.con2.fi` (the
  con2/redirects repo does hostname redirects) until Minio is decommissioned. Signed Minio URLs
  that were pasted into documents expire anyway and were never stable.

- The in-cluster endpoint `http://garage.garage.svc.cluster.local:3900` cannot be used for
  Outline: the browser must reach the same URL the server signs, so
  `AWS_S3_UPLOAD_BUCKET_URL=https://garage.con2.fi` and `AWS_S3_FORCE_PATH_STYLE=true` (the
  default). `AWS_REGION` must be `garage`: Garage validates the region in every signature and
  answers `AuthorizationHeaderMalformed` for anything else (`aws_region: garage` in the vars).

Per site, `kubernetes/migrate-to-garage.sh <site> prepare`, then commit and push, then
`kubernetes/migrate-to-garage.sh <site> finish`. Every step in it is idempotent, so a phase can be
rerun after a failure. What the two phases do:

1. `prepare`: creates the Garage bucket under the Minio bucket's name and a key of the same
   name, grants the key read/write/owner and `garage-backup-reader` read, copies the bucket from
   Minio with rclone (`--checksum`, then `rclone check --one-way`), writes the Garage key into the
   site's `outline` Secret, sets `aws_upload_bucket_url`, `aws_region: garage` and `aws_s3_acl: ""`
   in the site's vars file, and adds the bucket to both Garage backup CronJobs in the
   infrastructure checkout (`INFRASTRUCTURE_DIR`, default `../infrastructure`). It ends by listing
   what to commit: the CronJobs (commit and `kubectl apply`), and the vars file (commit and push
   `con2`, which deploys the switch).
2. `finish`: waits for the rollout, checks the pod really runs with the Garage endpoint and
   region, stores the bucket's CORS rule by running `con2-s3-cors.js` inside the pod through
   `docker-entrypoint.sh` (`kubectl exec` skips the entrypoint that derives `DATABASE_URL`),
   copies whatever reached Minio between the two phases, and verifies again.

The Minio key is read from the Secret while it still holds one. `finish` runs after the switch,
so it needs `MINIO_ACCESS_KEY_ID` and `MINIO_SECRET_ACCESS_KEY` exported; `MINIO_V2_AUTH=true`
makes rclone fall back to signature v2 if the 2020 Minio rejects v4.

Then verify in the browser: an old attachment opens (signed Garage URL), a new one uploads
without a CORS or 4xx error on the POST. Two weeks later, delete the Minio bucket. Once all five
are gone, Outline is off Minio; the remaining Minio tenants are tracked in the infrastructure
repository.

Done by hand before the script existed, for con2.fi on 2026-10-01: the bucket, key, first copy,
and the vars change. The things that went wrong on the way and are now built into the script: a
`VAR=value kubectl patch ... "$VAR"` one-liner writes empty strings (the shell expands the
argument before the prefix assignment applies); `kubectl exec ... node` fails on `DATABASE_URL`
without the entrypoint; Garage validates the signing region.

## Open questions, to settle before each step

- Helm: whether the five sites share one GitHub Actions deploy job (today) or get an environment
  per site, so a canary push does not need the workflow edited.
- CNPG: capacity check before adding five databases (small, but `kubectl cnpg status` and node
  memory first, per the README).
- Garage: confirm that Garage's PostObject accepts the exact policy the AWS SDK's
  `createPresignedPost` generates for Outline (content-length-range, key, Content-Type
  conditions). Test on the con2 bucket with a real upload before copying any data; if it does
  not, `AWS_S3_UPLOAD_METHOD=put` is the documented fallback and needs `PUT` in the CORS rule
  instead of `POST`.
