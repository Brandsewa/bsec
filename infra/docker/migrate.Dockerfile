# syntax=docker/dockerfile:1.7
# Built in CI only (PLAN §2). Context: repo root.  docker build -f infra/docker/migrate.Dockerfile .
ARG NODE_IMAGE=node:24.15.0-alpine

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate

FROM base AS prune
WORKDIR /repo
COPY . .
RUN pnpm dlx turbo@2.11.5 prune @bs/db --docker

FROM base AS build
WORKDIR /repo
COPY --from=prune /repo/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ .
RUN pnpm turbo run build --filter=@bs/db

FROM ${NODE_IMAGE} AS runtime
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
ENV NODE_ENV=production MIGRATIONS_DIR=/app/migrations
WORKDIR /app
COPY --from=build --chown=node:node /repo/packages/db/dist ./dist
COPY --from=build --chown=node:node /repo/packages/db/migrations ./migrations
USER node
# One-shot job. Every deploy: migrate (as app_owner). First deploy per env: bootstrap (superuser) first.
CMD ["node", "--enable-source-maps", "dist/deploy.js"]
