# syntax=docker/dockerfile:1.7
# Built in CI only (PLAN §2). Context: repo root.  docker build -f infra/docker/platform.Dockerfile .
ARG NODE_IMAGE=node:24.15.0-alpine

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate

FROM base AS prune
WORKDIR /repo
COPY . .
RUN pnpm dlx turbo@2.11.5 prune @bs/platform --docker

FROM base AS build
WORKDIR /repo
COPY --from=prune /repo/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ .
RUN pnpm turbo run build --filter=@bs/platform

FROM ${NODE_IMAGE} AS runtime
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
ENV NODE_ENV=production PORT=4000
WORKDIR /app
# Single-file bundle (esbuild): no node_modules in the runtime image.
COPY --from=build --chown=node:node /repo/apps/platform/dist ./dist
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3   CMD wget -qO- http://127.0.0.1:4000/health >/dev/null || exit 1
CMD ["node", "--enable-source-maps", "dist/main.js"]
