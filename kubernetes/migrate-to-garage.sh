#!/usr/bin/env bash
# Moves one Outline site's attachments from minio.con2.fi to garage.con2.fi.
#
#   kubernetes/migrate-to-garage.sh <site> prepare   # before the deploy
#   kubernetes/migrate-to-garage.sh <site> finish    # after the deploy
#
# <site> is one of con2 tracon kuplii ropecon kotae (the kubernetes/<site>.vars.yaml files).
# Every step is idempotent, so a phase can be rerun after a failure.
#
# prepare: Garage bucket, key and grants; first rclone copy from Minio; Garage key into the
#          site's `outline` Secret; Garage endpoint, region and empty ACL in the vars file; the
#          bucket added to the Garage backup CronJobs in the infrastructure repository. Ends by
#          printing what to commit and push. The push deploys the switch.
# finish:  waits for that rollout, stores the bucket's CORS rule from inside the pod, copies
#          whatever was uploaded to Minio in between, and verifies the copy.
#
# The Minio key is read from the site's Secret while it still holds one. After the switch it is
# gone from there, so `finish` needs MINIO_ACCESS_KEY_ID and MINIO_SECRET_ACCESS_KEY in the
# environment. MINIO_V2_AUTH=true makes rclone sign with signature v2 if the 2020 Minio rejects
# v4. INFRASTRUCTURE_DIR points at the infrastructure checkout (default: ../infrastructure).

set -euo pipefail

site="${1:?usage: $0 <site> prepare|finish}"
phase="${2:?usage: $0 <site> prepare|finish}"

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
vars_file="$repo_dir/kubernetes/$site.vars.yaml"
[ -f "$vars_file" ] || { echo "no such site: $vars_file" >&2; exit 1; }

namespace="outline"
[ "$site" = con2 ] || namespace="outline-$site"
bucket="$(awk '/^aws_upload_bucket_name:/ {print $2}' "$vars_file")"
hostname="$(awk '/^ingress_public_hostname:/ {print $2}' "$vars_file")"
infrastructure_dir="${INFRASTRUCTURE_DIR:-$repo_dir/../infrastructure}"
garage_url="https://garage.con2.fi"
minio_url="https://minio.con2.fi"

say() { printf '\n==> %s\n' "$*"; }
# The CLI logs its RPC handshake on stderr at INFO level on every call; drop just those lines.
garage() { kubectl -n garage exec garage-0 -c garage -- /garage "$@" 2> >(grep -v ' INFO ' >&2); }
secret_value() { kubectl -n "$namespace" get secret outline -o jsonpath="{.data.$1}" | base64 -d; }

garage_key_field() {
  garage key info --show-secret "$bucket" | awk -v label="$1" -F': *' '$1 == label {print $2}'
}

# Garage key ids start with GK, so the Secret still holds the Minio key when its id does not.
minio_credentials() {
  if [ -n "${MINIO_ACCESS_KEY_ID:-}" ] && [ -n "${MINIO_SECRET_ACCESS_KEY:-}" ]; then
    return
  fi
  local id
  id="$(secret_value awsAccessKeyId)"
  if [ -z "$id" ] || [[ "$id" == GK* ]]; then
    echo "The $namespace/outline Secret no longer holds the Minio key." >&2
    echo "Export MINIO_ACCESS_KEY_ID and MINIO_SECRET_ACCESS_KEY and rerun." >&2
    exit 1
  fi
  MINIO_ACCESS_KEY_ID="$id"
  MINIO_SECRET_ACCESS_KEY="$(secret_value awsSecretAccessKey)"
}

rclone_dir=""
rclone_config=""
write_rclone_config() {
  minio_credentials
  rclone_dir="$(mktemp -d)"
  rclone_config="$rclone_dir/rclone.conf"
  trap 'rm -rf "$rclone_dir"' EXIT
  (umask 077; cat > "$rclone_config" <<CONF
[minio]
type = s3
provider = Minio
endpoint = $minio_url
access_key_id = $MINIO_ACCESS_KEY_ID
secret_access_key = $MINIO_SECRET_ACCESS_KEY
region = eu-west-1
force_path_style = true
v2_auth = ${MINIO_V2_AUTH:-false}

[garage]
type = s3
provider = Other
endpoint = $garage_url
access_key_id = $garage_key_id
secret_access_key = $garage_key_secret
region = garage
force_path_style = true
CONF
  )
}

copy_from_minio() {
  write_rclone_config
  say "Copying minio:$bucket to garage:$bucket"
  rclone --config "$rclone_config" copy "minio:$bucket" "garage:$bucket" --checksum --transfers 8 --stats-one-line -v
  say "Checking the copy"
  rclone --config "$rclone_config" check --one-way "minio:$bucket" "garage:$bucket"
}

# set_var KEY VALUE replaces the top-level KEY in the vars file or appends it.
set_var() {
  if grep -q "^$1:" "$vars_file"; then
    perl -pi -e "s|^\Q$1\E:.*|$1: $2|" "$vars_file"
  else
    printf '%s: %s\n' "$1" "$2" >> "$vars_file"
  fi
}

# add_to_loop FILE PATTERN adds the bucket to a `for x in a b; do` line matched by PATTERN.
add_to_loop() {
  if grep -E "$2" "$1" | grep -qw "$bucket"; then
    return
  fi
  perl -pi -e "s|^(\s*for \w+ in [^;]*?)(; do)|\$1 $bucket\$2| if /$2/" "$1"
}

prepare() {
  say "Garage bucket $bucket"
  garage bucket info "$bucket" > /dev/null 2>&1 || garage bucket create "$bucket"

  say "Garage key $bucket"
  garage key info "$bucket" > /dev/null 2>&1 || garage key create "$bucket" > /dev/null
  garage_key_id="$(garage_key_field 'Key ID')"
  garage_key_secret="$(garage_key_field 'Secret key')"
  [ -n "$garage_key_id" ] && [ -n "$garage_key_secret" ] || { echo "could not read the Garage key" >&2; exit 1; }
  garage bucket allow --read --write --owner "$bucket" --key "$bucket" > /dev/null
  garage bucket allow --read "$bucket" --key garage-backup-reader > /dev/null

  copy_from_minio

  say "Writing the Garage key into $namespace/outline"
  kubectl -n "$namespace" patch secret outline --type merge \
    -p "$(jq -n --arg a "$garage_key_id" --arg s "$garage_key_secret" \
      '{stringData:{awsAccessKeyId:$a,awsSecretAccessKey:$s}}')" > /dev/null

  say "Pointing $vars_file at Garage"
  set_var aws_upload_bucket_url "$garage_url"
  set_var aws_region garage
  set_var aws_s3_acl '""'

  local garage_manifests="$infrastructure_dir/kubernetes/garage"
  if [ -d "$garage_manifests" ]; then
    say "Adding $bucket to the Garage backup CronJobs in $garage_manifests"
    add_to_loop "$garage_manifests/backup.cronjob-sync.yaml" 'for bucket in'
    add_to_loop "$garage_manifests/backup.cronjob-prune.yaml" 'for site in'
  else
    say "Infrastructure repository not found at $infrastructure_dir; add $bucket to both backup CronJobs by hand"
  fi

  say "Prepared. Now:"
  cat <<MSG
  1. In $infrastructure_dir: review, commit, and apply kubernetes/garage/backup.cronjob-*.yaml.
  2. In $repo_dir: review and commit kubernetes/$site.vars.yaml, push con2. The deploy switches
     $hostname to Garage.
  3. Once the rollout is done, run: MINIO_ACCESS_KEY_ID=$MINIO_ACCESS_KEY_ID MINIO_SECRET_ACCESS_KEY=... $0 $site finish
MSG
}

finish() {
  say "Waiting for the $namespace rollout"
  kubectl -n "$namespace" rollout status deploy/outline --timeout=10m

  local pod_env
  pod_env="$(kubectl -n "$namespace" exec deploy/outline -c outline -- env)"
  if ! grep -q "^AWS_S3_UPLOAD_BUCKET_URL=$garage_url$" <<< "$pod_env" || ! grep -q '^AWS_REGION=garage$' <<< "$pod_env"; then
    echo "The running pod is not configured for Garage yet; has the vars change been pushed and deployed?" >&2
    exit 1
  fi

  garage_key_id="$(garage_key_field 'Key ID')"
  garage_key_secret="$(garage_key_field 'Secret key')"

  say "Storing the CORS rule for https://$hostname on $bucket"
  kubectl -n "$namespace" exec deploy/outline -c outline -- \
    /opt/outline/docker-entrypoint.sh node build/server/scripts/con2-s3-cors.js

  copy_from_minio

  say "Done. Verify in a browser at https://$hostname:"
  cat <<MSG
  - open a document with an old image or attachment (download via signed Garage URL)
  - upload a new attachment and watch the console for CORS or 4xx errors on the POST
  In two weeks, delete the Minio bucket: rclone purge minio:$bucket (or from the Minio console).
MSG
}

case "$phase" in
  prepare) prepare ;;
  finish) finish ;;
  *) echo "usage: $0 <site> prepare|finish" >&2; exit 1 ;;
esac
