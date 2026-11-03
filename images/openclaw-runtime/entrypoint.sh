#!/bin/sh
# Entrypoint of the StarCi OpenClaw runtime layer (/opt/starci/entrypoint.sh).
#
# 1. The OpenClaw image has no `<NAME>_FILE` support, so every secret named in STARCI_SECRETS (space separated; OPENCLAW_GATEWAY_TOKEN is always
#    read) is exported from /run/secrets/<NAME> into THIS process tree only: no env file on the host, no value in the service specification.
# 2. openclaw-init.mjs merges the gateway settings into openclaw.json (idempotent; other keys, agents and plugins are kept) and enables the plugins
#    found under STARCI_PLUGINS_DIR.
# 3. openclaw-relay.mjs listens on the overlay address and forwards to the loopback-only gateway: the gateway honours the scopes a client
#    declares only for a loopback peer using the shared secret, so clients connect to the relay (OPENCLAW_RELAY_PORT, default 18790).
set -eu

for name in OPENCLAW_GATEWAY_TOKEN ${STARCI_SECRETS:-}; do
  file="/run/secrets/$name"
  if [ -r "$file" ]; then
    value="$(cat "$file")"
    export "$name=$value"
  fi
done
: "${OPENCLAW_GATEWAY_TOKEN:?the secret OPENCLAW_GATEWAY_TOKEN is not granted to this service}"

OPENCLAW_GATEWAY_TOKEN_FILE=/run/secrets/OPENCLAW_GATEWAY_TOKEN node /opt/starci/openclaw-init.mjs
node /opt/starci/openclaw-relay.mjs &
exec node openclaw.mjs gateway
