# Self-hosted GitHub Actions runner for this repo (ci.yml). Official runner image plus the tools ci.yml
# calls directly (docker CLI + compose + buildx, curl, jq, openssl). The Docker daemon is a separate
# docker:dind sidecar (see docker-compose.yml), so job steps behave like a GitHub-hosted ubuntu runner.
FROM ghcr.io/actions/actions-runner:latest

USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg jq openssl unzip zip git build-essential python3 \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin docker-buildx-plugin \
 && rm -rf /var/lib/apt/lists/*

COPY --chmod=0755 entrypoint.sh /entrypoint.sh
USER runner
ENTRYPOINT ["/entrypoint.sh"]
