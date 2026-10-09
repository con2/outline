# outline Helm chart

Deploys con2's Outline fork (`ghcr.io/con2/outline`, built by `.github/workflows/con2.yaml` from
`docker-bake.hcl`) as a Deployment with a migration init container and a Service, plus a
per-namespace Gateway with HTTPRoutes whose TLS certificate cert-manager issues from the
Gateway's `cert-manager.io/cluster-issuer` annotation. One release per site, each in its own
namespace with its own values file:

| Site | Namespace | Values | Hostname |
|---|---|---|---|
| con2 | `outline` | `values-con2.yaml` | outline.con2.fi |
| Tracon | `outline-tracon` | `values-tracon.yaml` | wiki.tracon.fi |
| Kuplii | `outline-kuplii` | `values-kuplii.yaml` | wiki.tamperekuplii.fi |
| Ropecon | `outline-ropecon` | `values-ropecon.yaml` | wiki.ropecon.fi |
| Kotae | `outline-kotae` | `values-kotae.yaml` | wiki.kotae.fi |

```sh
helm lint chart -f chart/values-con2.yaml
helm template outline chart -f chart/values-con2.yaml --set image.tag=dev
```

Every push to `con2` builds the image once and runs `helm upgrade --install` into the five
namespaces one after another, con2.fi first.

## Prerequisites per namespace

Two Secrets, created out of band and never in this repository.

```sh
kubectl create namespace outline-example
kubectl -n outline-example create secret generic outline \
  --from-literal=secretKey="$(openssl rand -hex 32)" \
  --from-literal=utilsSecretKey="$(openssl rand -hex 32)" \
  --from-literal=kompassiClientId=... \
  --from-literal=kompassiClientSecret=... \
  --from-literal=awsAccessKeyId=... \
  --from-literal=awsSecretAccessKey=...
```

The database Secret `postgres` (keys `hostname`, `database`, `username`, `password`) is written by
`infrastructure/kubernetes/postgres/create-app-database.sh` and `update-secret.sh`; the chart
never creates it. The Garage bucket, key and CORS rule come from `migrate-to-garage.sh` in this
directory (for a brand new site, run its `prepare` phase without a Minio source by exporting
empty `MINIO_*` variables, or create the bucket and key by hand as in
`infrastructure/kubernetes/garage/README.md`).

The Kompassi OIDC Application must allow the redirect URI `https://<hostname>/auth/kompassi.callback`
and use algorithm RS256.

## Changing a site

Group lists, Redis database, bucket and hostname are in the site's values file; push to deploy.
`kompassi.accessGroups` both gates sign-in and decides which Kompassi groups exist as Outline
groups, so a group meant to carry collection permissions goes there.

## Upgrading Outline

Merge upstream `main` into `con2` (the fork is upstream plus `plugins/kompassi`,
`plugins/local`, `Dockerfile.con2`, an Attachment override, a `kompassi` case in `AuthenticationProvider.oauthClient` and this chart), bump `appVersion`
in `Chart.yaml`, push. The init container runs the migrations before the new pod takes traffic;
a failed migration leaves the old ReplicaSet serving. Downgrading after a release with migrations
means restoring the database; `docs/con2/upgrade-runbook.md` has the full procedure from the
v0.67 to v1.10 jump.

## One-time cutover from the Emrichen manifests

The Deployment and Service in each namespace were created by `kubectl apply` through skaffold,
and the hostname was routed by an Ingress named `outline`. Do this by hand, one namespace at a
time, before the first push with this chart's workflow (that push will otherwise fail on the
Helm ownership check). con2.fi first.

1. Pick the image to install and the namespace. `sha` is the commit of a built image: there is
   none before the first workflow run, so either push once with the deploy job disabled, or build
   and push locally after `docker login ghcr.io`:

   ```sh
   sha=$(git rev-parse HEAD)
   TAG=$sha docker buildx bake --set '*.platform=linux/amd64' --push
   site=con2; ns=outline          # then tracon/outline-tracon, kuplii/outline-kuplii, ...
   ```

   Then mark the existing objects as belonging to the release:

   ```sh
   for object in deployment/outline service/outline; do
     kubectl -n $ns label "$object" app.kubernetes.io/managed-by=Helm
     kubectl -n $ns annotate "$object" meta.helm.sh/release-name=outline meta.helm.sh/release-namespace=$ns
   done
   ```

2. Read the diff against the live objects. Expect the new Gateway and HTTPRoutes, the strategy,
   resources, probes and security context, `replicas`, the image name changing from
   `ghcr.io/con2/outline-con2:<skaffold tag>` to `ghcr.io/con2/outline:$sha`, and
   `SMTP_SECURE`. No other env entry should change:

   ```sh
   helm template outline chart -f chart/values-$site.yaml --set image.tag=$sha \
     | kubectl -n $ns diff --server-side --force-conflicts -f -
   ```

3. Install:

   ```sh
   helm upgrade --install outline chart --namespace $ns -f chart/values-$site.yaml \
     --set image.tag=$sha --wait --timeout 600s --force-conflicts
   ```

   Helm installs with server-side apply, and every field the old manifests set is owned by
   `kubectl-client-side-apply`, so this first install needs `--force-conflicts`. Later deploys do
   not.

4. cert-manager issues a certificate for the Gateway into Secret `tls-outline`. Until it is Ready
   the Ingress keeps serving the hostname with its own certificate. Once
   `kubectl -n $ns get certificate tls-outline` shows Ready, delete the old routing:

   ```sh
   kubectl -n $ns delete ingress outline
   ```

   The Ingress owns Certificate `ingress-letsencrypt`, so it and its Secret should go with it.
   Check with `kubectl -n $ns get certificate,secret` and delete them by hand if they stay.

5. Repeat for the other four namespaces, then push `con2`.

Hostnames do not change, so neither DNS nor the Kompassi redirect URIs need updating.
