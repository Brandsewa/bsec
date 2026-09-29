# Deterministic k6 Load Test Suite Runner for Milestone M7 (PowerShell)
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$resultsDir = Join-Path $scriptDir "results"
if (!(Test-Path $resultsDir)) {
    New-Item -ItemType Directory -Path $resultsDir | Out-Null
}

Write-Host "=== Seeding database for load tests ===" -ForegroundColor Cyan
npx tsx (Join-Path $scriptDir "seed.ts")

$tests = @("storefront-browse.js", "search.js", "cart.js", "checkout.js", "admin-reads.js", "noisy-neighbour.js")

foreach ($t in $tests) {
    $name = [System.IO.Path]::GetFileNameWithoutExtension($t)
    Write-Host "--- Running $t ---" -ForegroundColor Yellow
    docker run --rm `
        -v "${scriptDir}:/loadtest" `
        grafana/k6 run "/loadtest/$t" `
        --summary-export="/loadtest/results/$name.json"
}

Write-Host "=== All load tests completed successfully ===" -ForegroundColor Green
