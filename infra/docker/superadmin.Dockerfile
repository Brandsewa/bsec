# syntax=docker/dockerfile:1.7
# Built in CI only (PLAN §2, §6). Context: repo root. docker build -f infra/docker/superadmin.Dockerfile .
ARG NODE_IMAGE=node:24.15.0-alpine

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate

FROM base AS prune
WORKDIR /repo
COPY . .
RUN pnpm dlx turbo@2.11.5 prune @bs/superadmin --docker

FROM base AS build
WORKDIR /repo
ARG VITE_SENTRY_DSN
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
COPY --from=prune /repo/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ .
RUN pnpm turbo run build --filter=@bs/superadmin

FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime
COPY infra/docker/superadmin.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/superadmin/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8080/health >/dev/null || exit 1
