#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
package_dir="$1"
production_dir="$2"
deployment_id="$3"
[[ "$package_dir" =~ ^/home/[a-zA-Z0-9_-]+/\.dilemma-deploy/[a-zA-Z0-9-]+$ ]]
[[ "$production_dir" =~ ^/[a-zA-Z0-9/_-]+$ ]]
[[ "$deployment_id" =~ ^[a-zA-Z0-9-]+$ ]]
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
mkdir "$package_dir/code"
tar -xzf "$package_dir/code.tar.gz" -C "$package_dir/code"
# Parent deployment directory stays private. Image source files must be readable
# by the non-root runtime user after Docker COPY preserves their permissions.
find "$package_dir/code" -type d -exec chmod 755 {} +
find "$package_dir/code" -type f -exec chmod 644 {} +
sudo -n docker build -t "$image" "$package_dir/code"
# Schema changes require a separate backed-up migration before deployment.
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
  if [[ "$(sudo -n docker inspect dilemma --format '{{.State.Running}}')" == true ]] &&
      sudo -n docker logs dilemma 2>&1 | grep -q 'Logged in as '; then
    echo "Discord login confirmed. Previous container: $previous"
    echo "Deployed code: $package_dir/code"
    sudo -n python3 "$package_dir/code/scripts/cleanup-production.py" "$(dirname "$package_dir")"
    exit 0
  fi
  sleep 1
done
echo 'No Discord login confirmation within 45 seconds.'
exit 1
