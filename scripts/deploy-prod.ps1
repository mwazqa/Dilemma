param(
  [string]$ConfigPath = "$PSScriptRoot/../.deploy.production.json",
  [switch]$ApplyMigrations,
  [ValidatePattern('^ghcr\.io/mwazqa/dilemma@sha256:[0-9a-f]{64}$')][string]$Image,
  [ValidatePattern('^[0-9a-f]{40}$')][string]$Commit
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if ([bool]$Image -ne [bool]$Commit) { throw 'Provide both the tested image reference and the Git commit.' }
& node scripts/check-secrets.mjs
if ($LASTEXITCODE -ne 0) { throw 'Secret scan failed; deployment stopped.' }
if (-not (Test-Path -LiteralPath $ConfigPath)) { throw 'Missing .deploy.production.json deployment configuration.' }
$deploymentConfig = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if ($deploymentConfig.host -notmatch '^[a-zA-Z0-9.-]+$' -or $deploymentConfig.user -notmatch '^[a-zA-Z0-9_-]+$' -or $deploymentConfig.path -notmatch '^/[a-zA-Z0-9/_-]+$') { throw 'Invalid SSH host, user or deployment path.' }
if (-not (Test-Path -LiteralPath $deploymentConfig.key -PathType Leaf)) { throw 'SSH key file is missing.' }
function Invoke-Checked([string]$Executable, [string[]]$Arguments) {
  $previousErrorPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $commandOutput = & $Executable @Arguments 2>&1
    $commandExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorPreference
  }
  if ($commandExitCode -ne 0) { throw "$Executable failed with exit code $commandExitCode. Raw output withheld for privacy." }
  Write-Host "$Executable completed successfully."
}
if (-not $Image) {
  foreach ($testName in @('check', 'build', 'test:db:fresh', 'test:ai', 'test:scoring', 'test:experience', 'test:achievements', 'test:score-card', 'test:features', 'test:languages', 'test:guide', 'test:command-ux', 'test:feedback-layout', 'test:topic-list', 'test:quiz-notifications', 'test:quiz-channels', 'test:native-polls', 'test:permissions', 'test:quiz-limits', 'test:topic-calendar', 'test:timezones', 'test:idle-database', 'test:poll-controls', 'test:privacy')) {
    Write-Host "Running $testName."
    Invoke-Checked 'npm.cmd' @('run', $testName)
  }
}
$deploymentId = [DateTime]::UtcNow.ToString('yyyyMMddHHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$deploymentDirectory = Join-Path ([IO.Path]::GetTempPath()) "dilemma-$deploymentId"
New-Item -ItemType Directory -Path $deploymentDirectory | Out-Null
if ($Image) {
  $run = & gh api "repos/mwazqa/Dilemma/actions/workflows/ci.yml/runs?branch=main&event=push&status=success&head_sha=$Commit&per_page=1" --jq '.workflow_runs[0].id // empty' 2>$null
  if ($LASTEXITCODE -ne 0 -or "$run" -notmatch '^\d+$') { throw 'Successful CI for this main commit was not found.' }
  Invoke-Checked 'gh' @('run', 'download', "$run", '--repo', 'mwazqa/Dilemma', '--name', "dilemma-image-$Commit", '--dir', $deploymentDirectory)
  $testedImage = (Get-Content -LiteralPath (Join-Path $deploymentDirectory 'dilemma-image-reference.txt') -Raw).Trim()
  if ($testedImage -cne $Image) { throw 'The image reference does not match the tested CI artifact.' }
} else {
  $deploymentArchive = Join-Path $deploymentDirectory 'code.tar.gz'
  Invoke-Checked 'tar.exe' @('-czf', $deploymentArchive, 'Dockerfile', '.dockerignore', 'package.json', 'package-lock.json', 'tsconfig.json', '.env.example', 'src', 'prisma/postgresql', 'scripts')
  $archiveEntries = & tar.exe -tzf $deploymentArchive 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'Deployment archive validation failed.' }
  foreach ($archiveEntry in $archiveEntries) {
    $entryName = ($archiveEntry -split '/')[-1]
    if (($entryName -match '^\.env($|\.)' -and $entryName -ne '.env.example') -or $entryName -match '(?i)(\.(key|pem|ppk|db)$|^id_(rsa|ed25519|ecdsa)$|^\.deploy\.production\.json$)') {
      throw 'Secret-bearing file type found in deployment archive. Upload stopped.'
    }
  }
}
$sshOptions = @('-i', $deploymentConfig.key, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15')
$deploymentTarget = "$($deploymentConfig.user)@$($deploymentConfig.host)"
$remoteDirectory = "/home/$($deploymentConfig.user)/.dilemma-deploy/$deploymentId"
Invoke-Checked 'ssh.exe' ($sshOptions + @($deploymentTarget, "umask 077; mkdir -p '$remoteDirectory'; chmod 700 '$remoteDirectory'"))
Invoke-Checked 'scp.exe' ($sshOptions + @('scripts/check-production-disk.sh', "${deploymentTarget}:${remoteDirectory}/check-production-disk.sh"))
if (-not $Image) {
  Invoke-Checked 'scp.exe' ($sshOptions + @($deploymentArchive, "${deploymentTarget}:${remoteDirectory}/code.tar.gz"))
}
Invoke-Checked 'scp.exe' ($sshOptions + @('scripts/deploy-prod.sh', "${deploymentTarget}:${remoteDirectory}/deploy-prod.sh"))
$migrationMode = if ($ApplyMigrations) { 'migrate' } else { 'check' }
$deployCommand = "bash '$remoteDirectory/deploy-prod.sh' '$remoteDirectory' '$($deploymentConfig.path)' '$deploymentId' '$migrationMode'"
if ($Image) { $deployCommand += " '$Image' '$Commit'" }
Invoke-Checked 'ssh.exe' ($sshOptions + @($deploymentTarget, $deployCommand))
Write-Host 'Production deployment completed. GitHub was not changed.'
