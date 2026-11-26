# Point-in-time restore drill from the REAL pgBackRest repository (R2 bucket bsec-pgbackrest) into a throwaway
# Postgres on this PC (docs/BACKUP-DR-PLAN.md G2, infra/backups/PGBACKREST.md). Needs Docker Desktop.
#   powershell -NoProfile -ExecutionPolicy Bypass -File infra/backups/pitr-drill.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File infra/backups/pitr-drill.ps1 -Image ghcr.io/brandsewa/bsec-postgres:sha-<commit>
# Use the READ-ONLY token for bsec-pgbackrest and the cipher passphrase from the password manager; they are typed at
# hidden prompts, kept in this PowerShell process only and cleared at the end. Archiving is forced off on the scratch
# copy (stock entrypoint, -c archive_mode=off), so it can never write to the live repository. Prints no secret values.
# Record the printed result in Super Admin > Backups > Record drill and in docs/changes/.
param(
  # Use the same pinned tag production runs (see infra/backups/PGBACKREST.md).
  [string]$Image = 'ghcr.io/brandsewa/bsec-postgres:sha-877bdeb418db0589df16130e289e0d6a27f121e3'
)
# 'Continue', not 'Stop': in Windows PowerShell 5.1 a native command's stderr (e.g. Postgres saying "starting up")
# would otherwise become a terminating error. Failures are checked explicitly with $LASTEXITCODE instead.
$ErrorActionPreference = 'Continue'
$Endpoint = '7a0533854a8ded58696db809f403f26c.r2.cloudflarestorage.com'
$Bucket = 'bsec-pgbackrest'
$Id = -join ((48..57) + (97..102) | Get-Random -Count 6 | ForEach-Object { [char]$_ })
$Vol = "pitr-drill-$Id"; $Ctr = "pitr-drill-$Id"

function Read-Secret($prompt) {
  $s = Read-Host -AsSecureString $prompt
  [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}
function Psql($sql) { (docker exec $Ctr psql -U postgres -d bsec -Atc $sql 2>&1 | Out-String).Trim() }

Write-Host "== bsec point-in-time restore drill (read-only, local) ==" -ForegroundColor Cyan
$env:PGBACKREST_REPO1_S3_ENDPOINT = $Endpoint
$env:PGBACKREST_REPO1_S3_BUCKET = $Bucket
$env:PGBACKREST_REPO1_S3_KEY = Read-Secret 'Read-only Access Key ID (hidden)'
$env:PGBACKREST_REPO1_S3_KEY_SECRET = Read-Secret 'Read-only Secret Access Key (hidden)'
$env:PGBACKREST_REPO1_CIPHER_PASS = Read-Secret 'pgBackRest cipher passphrase (hidden)'
$Target = Read-Host 'Target time in UTC, e.g. 2026-11-26 03:00:00.000+00 (press Enter for the latest point)'
$env:PGBACKREST_PROCESS_MAX = '8'   # more parallel fetches than the server's 2: restore and WAL replay are latency-bound
$Envs = @('-e','PGBACKREST_PROCESS_MAX','-e','PGBACKREST_REPO1_S3_ENDPOINT','-e','PGBACKREST_REPO1_S3_BUCKET','-e','PGBACKREST_REPO1_S3_KEY','-e','PGBACKREST_REPO1_S3_KEY_SECRET','-e','PGBACKREST_REPO1_CIPHER_PASS')

try {
  Write-Host "`n[1/5] Pulling the pinned image..."
  docker pull -q $Image | Out-Null
  docker volume create $Vol | Out-Null

  Write-Host "[2/5] Checking the repository with the read-only token..."
  docker run --rm @Envs --entrypoint sh $Image -c "gosu postgres pgbackrest --stanza=bsec info --log-level-console=warn" 2>&1 | Select-String -Pattern 'status|full backup|diff backup|wal archive' | ForEach-Object { '    ' + $_.Line.Trim() }

  $targetArgs = ''
  if ($Target.Trim()) { $targetArgs = "--type=time '--target=$($Target.Trim())' --target-action=promote" }
  Write-Host "[3/5] Restoring $(if ($targetArgs) { "to $Target" } else { 'to the latest point' }) into a throwaway volume..."
  $t0 = Get-Date
  docker run --rm -v "${Vol}:/var/lib/postgresql" @Envs --entrypoint sh $Image -c "mkdir -p /var/lib/postgresql/18/docker && chown -R postgres:postgres /var/lib/postgresql && chmod 700 /var/lib/postgresql/18/docker && gosu postgres pgbackrest --stanza=bsec restore $targetArgs --log-level-console=warn" 2>&1 | ForEach-Object { '    ' + $_ }
  if ($LASTEXITCODE -ne 0) { throw "pgbackrest restore failed (exit $LASTEXITCODE)" }
  $tRestore = [int]((Get-Date) - $t0).TotalSeconds

  Write-Host "[4/5] Starting it with archiving OFF and replaying WAL from R2..."
  docker run -d --name $Ctr -v "${Vol}:/var/lib/postgresql" -e POSTGRES_PASSWORD=drill @Envs --entrypoint docker-entrypoint.sh $Image postgres -c archive_mode=off | Out-Null
  $ready = $false
  $tReplay = Get-Date
  for ($i = 0; $i -lt 450; $i++) {
    Start-Sleep -Seconds 2
    $r = Psql 'SELECT pg_is_in_recovery()'
    if ($r -eq 'f') { $ready = $true; break }
    if ($i % 15 -eq 14) {
      $seg = (docker logs $Ctr 2>&1 | Select-String -Pattern 'restored log file' | Measure-Object).Count
      Write-Host ("    still replaying WAL: {0} s, {1} segments restored so far" -f [int]((Get-Date) - $tReplay).TotalSeconds, $seg)
    }
  }
  $tTotal = [int]((Get-Date) - $t0).TotalSeconds
  if (-not $ready) { docker logs --tail 20 $Ctr; throw 'database did not finish recovery within 15 minutes' }
  $segTotal = (docker logs $Ctr 2>&1 | Select-String -Pattern 'restored log file' | Measure-Object).Count
  Write-Host ("    WAL replay finished: {0} segments in {1} s" -f $segTotal, [int]((Get-Date) - $tReplay).TotalSeconds)

  Write-Host "[5/5] Checking the restored data..." -ForegroundColor Cyan
  Write-Host ("    archive_mode            : " + (Psql 'SHOW archive_mode'))
  Write-Host ("    migrations applied      : " + (Psql 'SELECT count(*) FROM drizzle.__drizzle_migrations'))
  foreach ($t in 'tenants','products','variants','customers','orders','audit_logs','platform_audit_logs') {
    Write-Host ("    {0,-24}: {1}" -f $t, (Psql "SELECT count(*) FROM $t"))
  }
  $newest = Psql "SELECT to_char(max(created_at) AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') FROM audit_logs"
  Write-Host ("    newest audit_logs row   : $newest UTC")
  Write-Host ("    restored at             : " + (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd HH:mm:ss') + ' UTC')
  Write-Host "`nRESULT: PASS  restore_seconds=$tRestore  total_seconds_to_usable=$tTotal" -ForegroundColor Green
}
catch {
  Write-Host "`nRESULT: FAIL  $($_.Exception.Message)" -ForegroundColor Red
}
finally {
  docker rm -f $Ctr 2>$null | Out-Null
  docker volume rm -f $Vol 2>$null | Out-Null
  'PGBACKREST_PROCESS_MAX','PGBACKREST_REPO1_S3_ENDPOINT','PGBACKREST_REPO1_S3_BUCKET','PGBACKREST_REPO1_S3_KEY','PGBACKREST_REPO1_S3_KEY_SECRET','PGBACKREST_REPO1_CIPHER_PASS' | ForEach-Object { Remove-Item "env:$_" -ErrorAction SilentlyContinue }
  Write-Host 'Scratch container and volume removed; secrets cleared from this session.'
}
