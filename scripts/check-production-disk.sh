#!/usr/bin/env bash
set -Eeuo pipefail

threshold="${1:-20}"
[[ "$threshold" =~ ^([1-9]|[1-9][0-9])$ ]] || { echo 'Invalid disk threshold.' >&2; exit 2; }
read -r percent_used available_kib < <(LC_ALL=C df -Pk / | awk 'NR == 2 { sub(/%$/, "", $5); print $5, $4; exit }')
[[ "$percent_used" =~ ^(0|[1-9][0-9]{0,2})$ && "$available_kib" =~ ^[0-9]+$ ]] || exit 2
free_percent=$(( 100 - percent_used ))
if (( free_percent < 0 )); then free_percent=0; fi
available_mib=$(( available_kib / 1024 ))
if (( free_percent < threshold )); then
  printf '<4>Dilemma disk alert: free=%s%% (%s MiB), threshold=%s%%.\n' "$free_percent" "$available_mib" "$threshold" >&2
  exit 1
fi
printf 'Dilemma disk check: free=%s%% (%s MiB), threshold=%s%%.\n' "$free_percent" "$available_mib" "$threshold"
