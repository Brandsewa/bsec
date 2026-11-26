#!/bin/sh
# Turns WAL archiving on only when pgBackRest has credentials, then hands over to the stock Postgres entrypoint.
# Why not always on: with no repository configured archive_command would fail every time and WAL would pile up on disk
# until the volume fills. Without the env vars this image behaves exactly like plain postgres:18.
set -eu

if [ "${1:-}" = "postgres" ]; then
  if [ -n "${PGBACKREST_REPO1_S3_KEY:-}" ] && [ -n "${PGBACKREST_REPO1_S3_KEY_SECRET:-}" ] \
     && [ -n "${PGBACKREST_REPO1_S3_BUCKET:-}" ] && [ -n "${PGBACKREST_REPO1_S3_ENDPOINT:-}" ] \
     && [ -n "${PGBACKREST_REPO1_CIPHER_PASS:-}" ]; then
    shift
    echo "bsec-postgres: pgBackRest configured, WAL archiving ON (stanza bsec)" >&2
    set -- postgres \
      -c archive_mode=on \
      -c "archive_command=pgbackrest --stanza=bsec archive-push %p" \
      -c archive_timeout=60 \
      "$@"
  else
    echo "bsec-postgres: PGBACKREST_REPO1_* not all set, WAL archiving OFF (plain Postgres behaviour)" >&2
  fi
fi

exec docker-entrypoint.sh "$@"
