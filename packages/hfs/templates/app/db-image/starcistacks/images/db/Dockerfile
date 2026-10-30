# Managed by starci app sync (slot app.db.image); do not edit: run "npx starci app sync --execute".
# The image of the db service of a lite app, kept with the stacks (rulings lite-official-postgres-image, lite-pgmq-bus-bullmq-jobs and
# lite-db-image-in-stacks): the Docker Official postgres image, pinned by digest, plus pgvector from the PGDG repository the image
# already configures and pgmq, the event bus, from its pinned release source verified by sha256 (pgmq is SQL objects only, so its
# control and script files are copied and nothing is compiled; it installs into its own schema pgmq). The contrib extensions
# (pgcrypto, pg_trgm, unaccent, uuid-ossp, btree_gist) ship in the image. The stack's db service, `npm run db:create`,
# `starci app db drift` and `starci app db baseline --squash` all build this file, with this folder as the build context.
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
