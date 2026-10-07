#!/usr/bin/env bash
set -euo pipefail
cd /home/runner

# Wait for the dind sidecar so the first job never starts without a Docker daemon.
for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 2; done
docker info >/dev/null

# Register once. The config lives in the container filesystem, so `docker restart` keeps it;
# recreating the container needs a fresh RUNNER_TOKEN (see README).
if [ ! -f .runner ]; then
  : "${RUNNER_TOKEN:?RUNNER_TOKEN is required for first registration}"
  ./config.sh --unattended --replace \
    --url "https://github.com/${GITHUB_REPOSITORY:-Brandsewa/bsec}" \
    --token "$RUNNER_TOKEN" \
    --name "${RUNNER_NAME:-bsec-local-1}" \
    --labels "${RUNNER_LABELS:-bsec-local}" \
    --work /home/runner/_work
fi

exec ./run.sh
