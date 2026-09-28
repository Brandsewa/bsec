# syntax=docker/dockerfile:1.7
# Built in CI only (PLAN §2). Context: repo root.  docker build -f infra/docker/web.Dockerfile .
ARG NODE_IMAGE=node:24.15.0-alpine

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate

FROM base AS prune
WORKDIR /repo
COPY . .
RUN pnpm dlx turbo@2.11.5 prune @bs/web --docker

FROM base AS build
WORKDIR /repo
COPY --from=prune /repo/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm turbo run build --filter=@bs/web

FROM ${NODE_IMAGE} AS runtime
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]
