param([string]$ConfigPath = "$PSScriptRoot/../.deploy.production.json", [switch]$ApplyMigrations)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
& node scripts/check-secrets.mjs
if ($LASTEXITCODE -ne 0) { throw 'Secret scan failed; deployment stopped.' }
if (-not (Test-Path -LiteralPath $ConfigPath)) { throw 'Missing .deploy.production.json deployment configuration.' }
$deploymentConfig = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if ($deploymentConfig.host -notmatch '^[a-zA-Z0-9.-]+$' -or $deploymentConfig.user -notmatch '^[a-zA-Z0-9_-]+$' -or $deploymentConfig.path -notmatch '^/[a-zA-Z0-9/_-]+$') { throw 'Invalid SSH host, user or deployment path.' }
if (-not (Test-Path -LiteralPath $deploymentConfig.key -PathType Leaf)) { throw 'SSH key file is missing.' }
function Invoke-Checked([string]$Executable, [string[]]$Arguments) {
  # Keep raw external output local: SSH errors and application logs can contain secrets.
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
foreach ($testName in @('check', 'build', 'test:db:fresh', 'test:scoring', 'test:features', 'test:quiz-limits', 'test:poll-controls', 'test:privacy')) {
  Write-Host "Running $testName."
  Invoke-Checked 'npm.cmd' @('run', $testName)
}
$deploymentId = [DateTime]::UtcNow.ToString('yyyyMMddHHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$deploymentDirectory = Join-Path ([IO.Path]::GetTempPath()) "dilemma-$deploymentId"
New-Item -ItemType Directory -Path $deploymentDirectory | Out-Null
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
$sshOptions = @('-i', $deploymentConfig.key, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15')
$deploymentTarget = "$($deploymentConfig.user)@$($deploymentConfig.host)"
$remoteDirectory = "/home/$($deploymentConfig.user)/.dilemma-deploy/$deploymentId"
Invoke-Checked 'ssh.exe' ($sshOptions + @($deploymentTarget, "umask 077; mkdir -p '$remoteDirectory'; chmod 700 '$remoteDirectory'"))
Invoke-Checked 'scp.exe' ($sshOptions + @($deploymentArchive, "${deploymentTarget}:${remoteDirectory}/code.tar.gz"))
Invoke-Checked 'scp.exe' ($sshOptions + @('scripts/deploy-prod.sh', "${deploymentTarget}:${remoteDirectory}/deploy-prod.sh"))
$migrationMode = if ($ApplyMigrations) { 'migrate' } else { 'check' }
Invoke-Checked 'ssh.exe' ($sshOptions + @($deploymentTarget, "bash '$remoteDirectory/deploy-prod.sh' '$remoteDirectory' '$($deploymentConfig.path)' '$deploymentId' '$migrationMode'"))
Write-Host 'Production deployment completed. GitHub was not changed.'
