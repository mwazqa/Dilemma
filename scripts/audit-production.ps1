$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
try {
  $configuration = Get-Content '.deploy.production.json' -Raw | ConvertFrom-Json
  if ($configuration.path -notmatch '^/[a-zA-Z0-9/_-]+$' -or $configuration.user -notmatch '^[a-zA-Z0-9_-]+$') { throw 'Invalid target' }
  $source = Get-Content "$PSScriptRoot/audit-production.py" -Raw
  $ErrorActionPreference = 'Continue'
  $result = $source | & ssh -i $configuration.key -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15 "$($configuration.user)@$($configuration.host)" "sudo -n python3 - '$($configuration.path)' '/home/$($configuration.user)/.dilemma-deploy'" 2>&1
  $commandExit = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($commandExit -ne 0) { throw 'Audit failed' }
  $summary = (($result | Out-String).Trim() | ConvertFrom-Json)
  $allowed = @('containers_checked','log_lines_checked','deployment_logs_checked','configured_credential_matches','credential_like_matches','container_match_lines','deployment_match_lines','uid_zero_accounts','privileged_group_members','admin_authorized_key_entries','sudo_policy_rule_count','log_forwarding_rules','known_log_collector_services','cloud_agent_running','scheduled_backup_entries','backup_timers','system_package_backup_timers','env_file_mode')
  foreach ($field in $allowed) {
    $value = [string]$summary.$field
    if ($value -notmatch '^(\d+|True|False)$') { throw 'Unexpected summary' }
    Write-Output "${field}=$value"
  }
} catch {
  Write-Output 'Production audit failed. Raw output withheld.'
  exit 1
}
