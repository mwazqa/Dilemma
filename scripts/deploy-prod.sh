#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
package_dir="$1"
production_dir="$2"
deployment_id="$3"
migration_mode="${4:-check}"
release_image="${5:-}"
release_commit="${6:-}"
[[ "$migration_mode" == check || "$migration_mode" == migrate ]]
[[ "$package_dir" =~ ^/home/[a-zA-Z0-9_-]+/\.dilemma-deploy/[a-zA-Z0-9-]+$ ]]
[[ "$production_dir" =~ ^/[a-zA-Z0-9/_-]+$ ]]
[[ "$deployment_id" =~ ^[a-zA-Z0-9-]+$ ]]
if [[ -n "$release_image" ]]; then
  [[ "$release_image" =~ ^ghcr\.io/mwazqa/dilemma@sha256:[0-9a-f]{64}$ && "$release_commit" =~ ^[0-9a-f]{40}$ ]] || {
    echo 'Use the pinned Dilemma image reference and its verified Git commit.' >&2
    exit 1
  }
elif [[ -n "$release_commit" ]]; then
  echo 'A Git commit requires a pinned image reference.' >&2
  exit 1
fi
exec 9>"$production_dir/.deployment.lock"
flock -n 9 || { echo 'Another deployment is running.'; exit 1; }
test -f "$production_dir/.env.docker"
[[ "$(sudo -n docker inspect dilemma --format '{{len .Mounts}}')" == 0 ]] || { echo 'Unexpected production mounts; manual deployment required.'; exit 1; }
[[ "$(sudo -n docker inspect dilemma --format '{{.HostConfig.NetworkMode}}')" == bridge ]] || { echo 'Unexpected production network; manual deployment required.'; exit 1; }
image="dilemma:local-$deployment_id"
previous="dilemma-rollback-$deployment_id"
switched=0
rollback() {
  local status=$?
  if (( status != 0 && switched == 1 )); then
    echo 'Deployment failed. Restoring previous container.'
    sudo -n docker rm -f dilemma >/dev/null 2>&1 || true
    sudo -n docker rename "$previous" dilemma
    sudo -n docker start dilemma >/dev/null
  fi
  exit "$status"
}
trap rollback EXIT
if [[ -f "$package_dir/check-production-disk.sh" ]]; then
  bash "$package_dir/check-production-disk.sh" 20
fi
if [[ -n "$release_image" ]]; then
  [[ -f "$package_dir/check-production-disk.sh" ]]
  sudo -n docker pull --platform linux/arm64 "$release_image"
  [[ "$(sudo -n docker image inspect --format '{{.Os}}/{{.Architecture}}' "$release_image")" == linux/arm64 ]]
  [[ "$(sudo -n docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$release_image")" == "$release_commit" ]] || {
    echo 'The downloaded image does not match the verified commit.' >&2
    exit 1
  }
  image="$release_image"
else
  mkdir "$package_dir/code"
  tar -xzf "$package_dir/code.tar.gz" -C "$package_dir/code"
  find "$package_dir/code" -type d -exec chmod 755 {} +
  find "$package_dir/code" -type f -exec chmod 644 {} +
  if [[ ! -f "$package_dir/check-production-disk.sh" && -f "$package_dir/code/scripts/check-production-disk.sh" ]]; then
    bash "$package_dir/code/scripts/check-production-disk.sh" 20
  fi
  sudo -n docker build -t "$image" "$package_dir/code"
fi
if [[ "$migration_mode" == migrate ]]; then
  if ! sudo -n docker run --rm --env-file "$production_dir/.env.docker" "$image" node scripts/migrate-postgres.mjs >"$package_dir/migration-apply.log" 2>&1; then
    echo 'Database migration failed. Previous production container remains running.'
    exit 1
  fi
fi
if ! sudo -n docker run --rm --env-file "$production_dir/.env.docker" "$image" node node_modules/prisma/build/index.js migrate status --schema prisma/postgresql/schema.prisma >"$package_dir/migration-status.log" 2>&1; then
  echo 'Database schema is not ready. Production remains running. Review migrations and back up before applying them.'
  exit 1
fi
sudo -n docker stop --time 20 dilemma >/dev/null
if ! sudo -n docker rename dilemma "$previous"; then
  sudo -n docker start dilemma >/dev/null
  exit 1
fi
switched=1
sudo -n docker run -d --name dilemma --restart unless-stopped \
  --user node --cap-drop ALL --security-opt no-new-privileges:true \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --env TZ=Europe/Warsaw --env-file "$production_dir/.env.docker" \
  --log-opt max-size=10m --log-opt max-file=3 \
  "$image" node dist/index.js >/dev/null
for attempt in {1..45}; do
  if [[ "$(sudo -n docker inspect dilemma --format '{{.State.Running}} {{.RestartCount}}')" == 'true 0' ]] &&
      sudo -n docker logs --tail 300 dilemma 2>&1 | grep 'Logged in as ' >/dev/null; then
    if [[ -n "$release_image" ]]; then
      sudo -n docker exec dilemma node --input-type=module -e '
        import { PrismaClient } from "@prisma/client";
        const db = new PrismaClient();
        try { await db.$queryRawUnsafe("SELECT 1"); } finally { await db.$disconnect(); }
      ' >/dev/null 2>&1 || { echo 'The deployed bot could not read its database.' >&2; exit 1; }
    else
      sudo -n python3 "$package_dir/code/scripts/cleanup-production.py" "$(dirname "$package_dir")"
    fi
    echo 'Discord login confirmed. Previous container retained for rollback.'
    exit 0
  fi
  sleep 1
done
echo 'No Discord login confirmation within 45 seconds.'
exit 1
