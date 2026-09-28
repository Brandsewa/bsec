All images share the same shape (see each Dockerfile):
1. prune   — `turbo prune <pkg> --docker` keeps only the workspace slice the app needs.
2. build   — install from the pruned lockfile, build with turbo.
3. runtime — minimal image, non-root user, no source, no dev deps, HEALTHCHECK.
Images are built in GitHub Actions and pushed to GHCR. Nothing is built on the VPS.
