# Managed by starci app sync (slot app.db.image); do not edit: run "npx starci app sync --write".
# The image of the db service of a lite app (rulings lite-official-postgres-image, lite-pgmq-bus-bullmq-jobs): the Docker Official postgres
# image, pinned by digest, plus pgvector from the PGDG repository the image already configures and pgmq, the event bus, from its pinned
# release source verified by sha256 (pgmq is SQL objects only, so its control and script files are copied, nothing is compiled). The
# contrib extensions (pgcrypto, pg_trgm, unaccent, uuid-ossp, btree_gist) ship in the image. The stack's db service,
# `npm run db:create` and `starci app db drift` all build this file.
FROM postgres:17.11@sha256:31ba9c94a03ada9988f2bb493a22a75eef3a185884533e5cdbcd498ea835b08f
ADD --checksum=sha256:67221f288f42f95c002a64df40f7d660e765e32df8ada0f2672ba915a14827f7 https://github.com/pgmq/pgmq/archive/refs/tags/v1.13.1.tar.gz /tmp/pgmq.tar.gz
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-17-pgvector=0.8.7-1.pgdg13+1 \
    && rm -rf /var/lib/apt/lists/* \
    && tar -xzf /tmp/pgmq.tar.gz -C /tmp \
    && extension="$(pg_config --sharedir)/extension" \
    && cp /tmp/pgmq-1.13.1/pgmq-extension/pgmq.control "$extension/" \
    && cp /tmp/pgmq-1.13.1/pgmq-extension/sql/pgmq.sql "$extension/pgmq--1.13.1.sql" \
    && cp /tmp/pgmq-1.13.1/pgmq-extension/sql/pgmq--*--*.sql "$extension/" \
    && rm -rf /tmp/pgmq.tar.gz /tmp/pgmq-1.13.1
