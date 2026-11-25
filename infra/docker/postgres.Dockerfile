# syntax=docker/dockerfile:1.7
# bsec-postgres: the official Postgres image plus pgBackRest (docs/BACKUP-DR-PLAN.md G1). Built in CI like the app images.
#   docker build -f infra/docker/postgres.Dockerfile -t bsec-postgres:18 .
# Same major version and the same data volume as plain postgres:18, so swapping the image is a restart, not a migration.
# The base tag floats within PG 18 (as production does today); pgBackRest is pinned to an exact package version.
ARG POSTGRES_IMAGE=postgres:18
FROM ${POSTGRES_IMAGE}

# ca-certificates is NOT in the postgres base image: without it pgBackRest cannot verify R2's TLS certificate
# ("unable to get local issuer certificate", found at the first production cutover 2026-11-25). The build fails if the
# bundle is missing.
# Exact version from the PGDG repo that the base image already has configured. If PGDG drops this build the image fails
# to build (loud), rather than silently picking a different version: bump it deliberately and rerun the PITR rehearsal.
ARG PGBACKREST_VERSION=2.60.1-1.pgdg13+1
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates pgbackrest=${PGBACKREST_VERSION} \
 && test -s /etc/ssl/certs/ca-certificates.crt \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /etc/pgbackrest /var/log/pgbackrest /var/spool/pgbackrest \
 && chown postgres:postgres /var/log/pgbackrest /var/spool/pgbackrest

# Non-secret settings only. Endpoint, bucket, keys and the cipher passphrase come from PGBACKREST_REPO1_* env vars.
COPY infra/backups/pgbackrest.conf /etc/pgbackrest/pgbackrest.conf
COPY infra/docker/postgres-entrypoint.sh /usr/local/bin/bsec-postgres-entrypoint.sh
RUN chmod 0755 /usr/local/bin/bsec-postgres-entrypoint.sh

ENTRYPOINT ["bsec-postgres-entrypoint.sh"]
CMD ["postgres"]
