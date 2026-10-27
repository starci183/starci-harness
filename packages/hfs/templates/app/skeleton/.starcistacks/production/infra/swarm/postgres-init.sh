#!/usr/bin/env bash
# PostgreSQL runs this config only when its data volume is empty.
set -euo pipefail

PRIMARY_DB_PASSWORD="$(cat "${PRIMARY_DB_PASSWORD_FILE:?}")"
if [[ -z "$PRIMARY_DB_PASSWORD" || "$PRIMARY_DB_PASSWORD" == *$'\n'* || "$PRIMARY_DB_PASSWORD" == *$'\r'* ]]; then
    builtin printf '%s\n' 'The application password must be non-empty and contain no line breaks.' >&2
    exit 1
fi
psql --no-psqlrc --no-password --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 <<'SQL'
\getenv app_database POSTGRES_DB
CREATE ROLE app_be WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
REVOKE ALL ON DATABASE :"app_database" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"app_database" TO app_be;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO app_be;
SQL
# The service has no TTY; psql reads both hidden prompts from this pipe and encrypts the password before sending SQL.
builtin printf '%s\n%s\n' "$PRIMARY_DB_PASSWORD" "$PRIMARY_DB_PASSWORD" |
    psql --no-psqlrc --no-password --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 --command '\password app_be'
unset PRIMARY_DB_PASSWORD
