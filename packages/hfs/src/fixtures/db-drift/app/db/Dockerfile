# Managed by starci app sync (slot app.db.image); do not edit: run "npx starci app sync --write".
# The image of the db service of a lite app (ruling lite-official-postgres-image): the Docker Official postgres image, pinned by
# digest, plus pgvector from the PGDG repository the image already configures. The contrib extensions (pgcrypto, pg_trgm, unaccent,
# uuid-ossp, btree_gist) ship in the image. The stack's db service, `npm run db:create` and `starci app db drift` all build this file.
FROM postgres:17.11@sha256:31ba9c94a03ada9988f2bb493a22a75eef3a185884533e5cdbcd498ea835b08f
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-17-pgvector=0.8.7-1.pgdg13+1 \
    && rm -rf /var/lib/apt/lists/*
