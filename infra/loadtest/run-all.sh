#!/usr/bin/env bash
# Deterministic k6 Load Test Suite Runner for Milestone M7
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$DIR/results"

echo "=== Seeding database for load tests ==="
npx tsx "$DIR/seed.ts"

echo "=== Running k6 Load Tests ==="
tests=("storefront-browse.js" "search.js" "cart.js" "checkout.js" "admin-reads.js" "noisy-neighbour.js")

for test in "${tests[@]}"; do
  name="${test%.js}"
  echo "--- Running $test ---"
  docker run --rm \
    -v "$DIR:/loadtest" \
    grafana/k6 run "/loadtest/$test" \
    --summary-export="/loadtest/results/$name.json"
done

echo "=== All load tests completed successfully ==="
