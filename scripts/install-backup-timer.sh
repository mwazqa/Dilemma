#!/usr/bin/env bash
set -Eeuo pipefail

(( EUID == 0 )) || { echo 'Run the backup timer installer as root.' >&2; exit 1; }
umask 077
production="${1:?Provide the private production directory}"
[[ "$production" =~ ^/[a-zA-Z0-9/_-]+$ && $(realpath -- "$production") == "$production" && -f "$production/.env.docker" ]]
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
config=/etc/dilemma/backup-production-directory
destination=/usr/local/libexec/dilemma/backup-production.py
unit_dir=/etc/systemd/system
backup_dir=/var/lib/dilemma/backups
service=dilemma-db-backup.service
timer=dilemma-db-backup.timer

for path in "$config" "$destination" "$unit_dir/$service" "$unit_dir/$timer" "$backup_dir"; do
  [[ $(realpath -m -- "$path") == "$path" ]]
done
check_destination() {
  local source="$1" target="$2"
  [[ -f "$source" && ! -L "$source" ]]
  if [[ -e "$target" ]]; then
    [[ -f "$target" ]] && cmp -s -- "$source" "$target"
  fi
}
check_destination "$source_dir/backup-production.py" "$destination"
check_destination "$source_dir/systemd/$service" "$unit_dir/$service"
check_destination "$source_dir/systemd/$timer" "$unit_dir/$timer"
if [[ -e "$config" ]]; then
  [[ -f "$config" && $(cat -- "$config") == "$production" ]]
fi

install -d -m 0700 -- "$(dirname -- "$config")" "$backup_dir"
install -d -m 0755 -- "$(dirname -- "$destination")"
if [[ ! -e "$config" ]]; then
  (set -o noclobber; printf '%s\n' "$production" > "$config")
fi
chmod 0600 -- "$config"
install -m 0644 -- "$source_dir/backup-production.py" "$destination"
install -m 0644 -- "$source_dir/systemd/$service" "$unit_dir/$service"
install -m 0644 -- "$source_dir/systemd/$timer" "$unit_dir/$timer"
systemd-analyze verify "$unit_dir/$service" "$unit_dir/$timer"
systemctl daemon-reload
systemctl enable --now "$timer"
systemctl is-active --quiet "$timer"
systemctl is-enabled --quiet "$timer"
echo 'Daily Dilemma backup timer is active.'
