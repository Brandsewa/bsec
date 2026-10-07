# Self-hosted CI runner (Docker Desktop)

Runs the `.github/workflows/ci.yml` jobs on this Windows PC instead of GitHub-hosted runners
(added 2026-10-07 when GitHub-hosted jobs stopped starting because of an account billing block).

## How it works
- `dind` is a privileged `docker:dind` container that owns the Docker daemon.
- `runner` is the official Actions runner image plus the docker CLI, curl, jq and openssl. It shares
  `dind`'s network namespace, so a job's Postgres service on `:5432` is reachable at `localhost`, and both
  containers mount the same work volume, so `docker run -v "$PWD:/repo"` (secret-scan) works.
- `ci.yml` uses `runs-on: ${{ vars.CI_RUNNER || 'ubuntu-24.04' }}`. Repo variable **CI_RUNNER = `bsec-local`**
  sends jobs here; **delete the variable** to go back to GitHub-hosted runners. Nothing else changes.

## Start, stop, check
```bash
cd infra/ci-runner
docker compose up -d            # start (registration already stored in the container)
docker compose logs -f runner   # look for "Listening for Jobs"
docker compose stop             # stop
gh api repos/Brandsewa/bsec/actions/runners --jq '.runners[] | {name,status,busy}'
```
Docker Desktop must be running and the PC awake: while the PC is off, CI and deploys wait in the queue.

## Re-register (container recreated, or `docker compose down`)
```bash
export RUNNER_TOKEN=$(gh api -X POST repos/Brandsewa/bsec/actions/runners/registration-token --jq .token)
docker compose up -d --build && unset RUNNER_TOKEN
```
The token is short-lived and is never committed. Remove a stale runner with
`gh api -X DELETE repos/Brandsewa/bsec/actions/runners/<id>`.

## Security notes
- `dind` is privileged (root-equivalent inside the Docker VM). Only run this for a **private** repo whose
  contributors you trust; do not enable it for public forks or untrusted pull requests.
- The runner can read repository secrets used by CI (GHCR push, Coolify deploy token). Keep the PC secured.
- Docker Desktop's VM memory (Settings, Resources) should be at least 8 GB; the heavy test job runs Postgres
  plus a full Next build.
- Cleanup if the disk fills: `docker compose exec dind docker system prune -af`.
