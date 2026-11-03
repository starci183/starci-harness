#!/bin/sh
# Entrypoint of the StarCi OpenClaw runtime layer (/opt/starci/entrypoint.sh).
#
# 0. Started as root, it gives the state folder (<home of STARCI_RUNTIME_USER>/.openclaw, often a bind mount the host created as root) to
#    STARCI_RUNTIME_USER when that user does not own it yet (idempotent), then runs itself again as that user with setpriv; nothing else
#    runs as root.
# 1. The OpenClaw image has no `<NAME>_FILE` support, so every secret named in STARCI_SECRETS (space separated; OPENCLAW_GATEWAY_TOKEN is always
#    read) is exported from /run/secrets/<NAME> into THIS process tree only: no env file on the host, no value in the service specification.
# 2. openclaw-init.mjs merges the gateway settings into openclaw.json (idempotent; other keys, agents and plugins are kept) and enables the plugins
#    found under STARCI_PLUGINS_DIR.
# 3. openclaw-relay.mjs listens on the overlay address and forwards to the loopback-only gateway: the gateway honours the scopes a client
#    declares only for a loopback peer using the shared secret, so clients connect to the relay (OPENCLAW_RELAY_PORT, default 18790).
set -eu

if [ "$(id -u)" = 0 ]; then
  user="${STARCI_RUNTIME_USER:?the image names no STARCI_RUNTIME_USER}"
  home="$(getent passwd "$user" | cut -d: -f6)"
  state="$home/.openclaw"
  mkdir -p "$state"
  if [ "$(stat -c %u "$state")" != "$(id -u "$user")" ]; then chown -R "$user:" "$state"; fi
  chmod u+rwx "$state"
  HOME="$home" exec setpriv --reuid="$user" --regid="$user" --init-groups -- sh "$0" "$@"
fi

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
