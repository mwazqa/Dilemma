#!/usr/bin/env bash
set -Eeuo pipefail

(( EUID == 0 )) || { echo 'Run the disk monitor installer as root.' >&2; exit 1; }
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
script_path=/usr/local/libexec/dilemma/check-production-disk.sh
unit_dir=/etc/systemd/system
service=dilemma-disk-monitor.service
timer=dilemma-disk-monitor.timer

[[ $(realpath -m -- "$script_path") == "$script_path" && $(realpath -m -- "$unit_dir") == "$unit_dir" ]]
bash -n "$source_dir/check-production-disk.sh"

check_destination() {
  local source="$1" destination="$2"
  [[ -f "$source" && ! -L "$source" ]]
  if [[ -e "$destination" || -L "$destination" ]]; then
    [[ -f "$destination" && ! -L "$destination" ]] && cmp -s -- "$source" "$destination" || {
      echo 'A different disk monitor file already exists. Review it before replacing it.' >&2
      exit 1
    }
  fi
}

check_destination "$source_dir/check-production-disk.sh" "$script_path"
check_destination "$source_dir/systemd/$service" "$unit_dir/$service"
check_destination "$source_dir/systemd/$timer" "$unit_dir/$timer"
install -d -m 0755 -- "$(dirname -- "$script_path")"
install -m 0755 -- "$source_dir/check-production-disk.sh" "$script_path"
install -m 0644 -- "$source_dir/systemd/$service" "$unit_dir/$service"
install -m 0644 -- "$source_dir/systemd/$timer" "$unit_dir/$timer"
systemd-analyze verify "$unit_dir/$service" "$unit_dir/$timer"
systemctl daemon-reload
systemctl enable --now "$timer"
systemctl start "$service"
systemctl is-active --quiet "$timer"
systemctl is-enabled --quiet "$timer"
echo 'Dilemma disk timer is active and the first check passed.'
