# syntax=docker/dockerfile:1.7
# Built in CI only (PLAN §2). Context: repo root.  docker build -f infra/docker/worker.Dockerfile .
ARG NODE_IMAGE=node:24.15.0-alpine

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate

FROM base AS prune
WORKDIR /repo
COPY . .
RUN pnpm dlx turbo@2.11.5 prune @bs/worker --docker

FROM base AS build
WORKDIR /repo
COPY --from=prune /repo/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ .
RUN pnpm turbo run build --filter=@bs/worker

FROM ${NODE_IMAGE} AS runtime
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
ENV NODE_ENV=production PORT=4100
WORKDIR /app
# Single-file bundle (esbuild). The only node_modules is sharp (native image library used by media.derive);
# its version must match packages/domain/package.json. npm picks the musl prebuilt binary for this Alpine image.
RUN npm install --no-save --no-audit --no-fund --omit=dev --ignore-scripts=false sharp@0.35.5  && npm cache clean --force  && rm -f package.json package-lock.json
COPY --from=build --chown=node:node /repo/apps/worker/dist ./dist
# Local media directory (STORAGE_LOCAL_DIR/MEDIA_LOCAL_DIR in compose and local stacks). Created here and owned by the
# runtime user so a freshly created named volume mounted at /data/media is writable (a root-owned volume gives EACCES).
RUN mkdir -p /data/media && chown node:node /data/media
USER node
EXPOSE 4100
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3   CMD wget -qO- http://127.0.0.1:4100/health >/dev/null || exit 1
CMD ["node", "--enable-source-maps", "dist/main.js"]
