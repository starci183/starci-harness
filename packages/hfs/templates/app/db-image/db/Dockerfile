# Managed by starci app sync (slot app.db.image); do not edit: run "npx starci app sync --write".
# The image of the db service of a lite app (rulings lite-official-postgres-image, lite-pgmq-bus-bullmq-jobs): the Docker Official postgres
# image, pinned by digest, plus pgvector from the PGDG repository the image already configures and pgmq, the event bus, from its pinned
# release source verified by sha256 (pgmq is SQL objects only, so its control and script files are copied, nothing is compiled). The
# contrib extensions (pgcrypto, pg_trgm, unaccent, uuid-ossp, btree_gist) ship in the image. The stack's db service,
# `npm run db:create` and `starci app db drift` all build this file.
FROM {{dbBaseImage}}
ADD --checksum=sha256:{{pgmqSha256}} {{pgmqSource}} /tmp/pgmq.tar.gz
RUN apt-get update \
    && apt-get install -y --no-install-recommends {{pgvectorPackage}} \
    && rm -rf /var/lib/apt/lists/* \
    && tar -xzf /tmp/pgmq.tar.gz -C /tmp \
    && extension="$(pg_config --sharedir)/extension" \
    && cp /tmp/pgmq-{{pgmqVersion}}/pgmq-extension/pgmq.control "$extension/" \
    && cp /tmp/pgmq-{{pgmqVersion}}/pgmq-extension/sql/pgmq.sql "$extension/pgmq--{{pgmqVersion}}.sql" \
    && cp /tmp/pgmq-{{pgmqVersion}}/pgmq-extension/sql/pgmq--*--*.sql "$extension/" \
    && rm -rf /tmp/pgmq.tar.gz /tmp/pgmq-{{pgmqVersion}}
