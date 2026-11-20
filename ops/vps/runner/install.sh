#!/bin/bash
# install.sh - installs the CI deploy runner on a managed server, as root (sudo -n bash -s -- <action> ... < install.sh). Idempotent; every action
# prints what it changed; `uninstall` is the undo of all of them. No secret is ever an argument: the private repo key and the registry token come on stdin.
#   base                         pinned Node and sops, the account starci-runner (no password, key only), the gate and the runner in /usr/local/sbin,
#                                the sudo rule, /etc/starci-runner with GitHub's pinned host keys, the log folder
#   app <app>                    lists <app> and installs /etc/starci-runner/<app>.conf from stdin (REPO_URL, IMAGE_PREFIX, SERVICES_staging, SERVICES_production)
#   repo-key <app>               stdin: the READ-ONLY GitHub deploy key (private half) of the app's repository -> /etc/starci-runner/<app>/repo_key
#   registry-token <app>         stdin: two lines, the registry user and a read:packages token -> /etc/starci-runner/<app>/registry_token
#   ci-key <app>                 stdin: the PUBLIC half of the CI deploy key; one forced-command line per app in ~starci-runner/.ssh/authorized_keys
#   status                       what is installed (no secret)
#   uninstall                    removes everything above (the pinned Node and sops stay unless --all)
set -euo pipefail
umask 022
NODE_VERSION=22.20.0
NODE_SHA256=00bbd05e306ea68b6e13e17360d0e2f680b493ef95f2fea1c4296ff7437530bc
SOPS_VERSION=3.13.2
SOPS_SHA256=154dfe4cd70554bdd82b98e4cd4acf191d43d01ead6f00a73477aa44c4ac42ef
# api.github.com/meta ssh_keys, read 2026-11-21
GITHUB_KNOWN_HOSTS='github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl
github.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg='
RUNNER=starci-runner
RUNNER_HOME=/var/lib/starci-runner-home
ETC=/etc/starci-runner
SRC_BASE=${STARCI_RUNNER_SRC:-https://raw.githubusercontent.com/starci183/starci-harness/main/ops/vps/runner}

[ "$(id -u)" -eq 0 ] || { echo "install.sh: run as root" >&2; exit 2; }
action=${1:-}; shift || true
app_ok() { case "${1:-}" in ''|-*|*[!a-z0-9-]*) echo "install.sh: app name" >&2; exit 2 ;; esac; }
fetch() { curl -fsSL --proto '=https' --tlsv1.2 -o "$2" "$1"; }
check() { echo "$2  $1" | sha256sum -c --quiet - || { echo "install.sh: checksum mismatch for $1" >&2; rm -f "$1"; exit 4; }; }

base() {
  if [ "$(/opt/starci-node/bin/node --version 2>/dev/null)" != "v$NODE_VERSION" ]; then
    t=$(mktemp -d); fetch "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz" "$t/node.tar.xz"; check "$t/node.tar.xz" "$NODE_SHA256"
    rm -rf "/opt/starci-node-$NODE_VERSION"; mkdir -p "/opt/starci-node-$NODE_VERSION"; tar -xJf "$t/node.tar.xz" -C "/opt/starci-node-$NODE_VERSION" --strip-components=1
    ln -sfn "/opt/starci-node-$NODE_VERSION" /opt/starci-node; rm -rf "$t"; echo "installed Node $NODE_VERSION at /opt/starci-node"
  else echo "Node $NODE_VERSION already at /opt/starci-node"; fi
  if [ "$(/usr/local/bin/sops --version 2>/dev/null | awk 'NR==1{print $2}')" != "$SOPS_VERSION" ]; then
    t=$(mktemp -d); fetch "https://github.com/getsops/sops/releases/download/v$SOPS_VERSION/sops-v$SOPS_VERSION.linux.amd64" "$t/sops"; check "$t/sops" "$SOPS_SHA256"
    install -m 755 -o root -g root "$t/sops" /usr/local/bin/sops; rm -rf "$t"; echo "installed sops $SOPS_VERSION at /usr/local/bin/sops"
  else echo "sops $SOPS_VERSION already at /usr/local/bin/sops"; fi
  if ! id "$RUNNER" > /dev/null 2>&1; then
    useradd --system --home-dir "$RUNNER_HOME" --create-home --shell /bin/sh "$RUNNER"; usermod -L "$RUNNER"; echo "created account $RUNNER (locked password)"
  fi
  install -d -m 700 -o "$RUNNER" -g "$RUNNER" "$RUNNER_HOME/.ssh"
  touch "$RUNNER_HOME/.ssh/authorized_keys"; chown "$RUNNER:$RUNNER" "$RUNNER_HOME/.ssh/authorized_keys"; chmod 600 "$RUNNER_HOME/.ssh/authorized_keys"
  for f in starci-deploy-gate starci-deploy-run; do
    if [ -n "${STARCI_RUNNER_LOCAL:-}" ]; then cp "$STARCI_RUNNER_LOCAL/$f" "/tmp/$f.new"; else fetch "$SRC_BASE/$f" "/tmp/$f.new"; fi
    install -m 755 -o root -g root "/tmp/$f.new" "/usr/local/sbin/$f"; rm -f "/tmp/$f.new"; echo "installed /usr/local/sbin/$f"
  done
  printf '%s ALL=(root) NOPASSWD: /usr/local/sbin/starci-deploy-run\nDefaults:%s !requiretty\n' "$RUNNER" "$RUNNER" > /tmp/90-starci-runner
  visudo -cf /tmp/90-starci-runner > /dev/null; install -m 440 -o root -g root /tmp/90-starci-runner /etc/sudoers.d/90-starci-runner; rm -f /tmp/90-starci-runner
  echo "installed /etc/sudoers.d/90-starci-runner (starci-runner may run only /usr/local/sbin/starci-deploy-run as root)"
  install -d -m 755 -o root -g root "$ETC"; touch "$ETC/apps"; chmod 644 "$ETC/apps"
  printf '%s\n' "$GITHUB_KNOWN_HOSTS" > "$ETC/github_known_hosts"; chmod 644 "$ETC/github_known_hosts"
  install -d -m 733 -o root -g root /var/log/starci-runner; touch /var/log/starci-runner/gate.log; chown "$RUNNER" /var/log/starci-runner/gate.log; chmod 640 /var/log/starci-runner/gate.log
  install -d -m 700 -o root -g root /var/lib/starci-runner
  echo "base done"
}

case "$action" in
  base) base ;;
  app)
    app_ok "${1:-}"; app=$1
    install -d -m 700 -o root -g root "$ETC/$app"
    t=$(mktemp); cat > "$t"; grep -q '^REPO_URL=' "$t" && grep -q '^IMAGE_PREFIX=ghcr.io/' "$t" || { rm -f "$t"; echo "install.sh: the config needs REPO_URL and IMAGE_PREFIX=ghcr.io/..." >&2; exit 2; }
    install -m 600 -o root -g root "$t" "$ETC/$app.conf"; rm -f "$t"
    grep -qx -- "$app" "$ETC/apps" || echo "$app" >> "$ETC/apps"
    echo "listed $app; wrote $ETC/$app.conf" ;;
  repo-key)
    app_ok "${1:-}"; app=$1; install -d -m 700 -o root -g root "$ETC/$app"
    t=$(mktemp); cat > "$t"; ssh-keygen -y -f "$t" > /dev/null 2>&1 || { rm -f "$t"; echo "install.sh: stdin is not a private ssh key" >&2; exit 2; }
    install -m 600 -o root -g root "$t" "$ETC/$app/repo_key"; rm -f "$t"; echo "wrote $ETC/$app/repo_key (public: $(ssh-keygen -y -f "$ETC/$app/repo_key" | cut -d' ' -f1-2 | cut -c1-40)...)" ;;
  registry-token)
    app_ok "${1:-}"; app=$1; install -d -m 700 -o root -g root "$ETC/$app"
    t=$(mktemp); cat > "$t"; [ "$(wc -l < "$t")" -ge 2 ] || { rm -f "$t"; echo "install.sh: stdin needs two lines: user, token" >&2; exit 2; }
    install -m 600 -o root -g root "$t" "$ETC/$app/registry_token"; rm -f "$t"; echo "wrote $ETC/$app/registry_token" ;;
  ci-key)
    app_ok "${1:-}"; app=$1
    read -r kind blob _ || true
    case "$kind" in ssh-ed25519) ;; *) echo "install.sh: an ssh-ed25519 public key on stdin" >&2; exit 2 ;; esac
    case "$blob" in ''|*[!A-Za-z0-9+/=]*) echo "install.sh: key blob" >&2; exit 2 ;; esac
    f=$RUNNER_HOME/.ssh/authorized_keys; [ -d "$RUNNER_HOME/.ssh" ] || { echo "install.sh: run base first" >&2; exit 2; }; touch "$f"
    grep -v " $app-ci-deploy\$" "$f" > "$f.new" || true
    printf 'restrict,command="/usr/local/sbin/starci-deploy-gate" %s %s %s-ci-deploy\n' "$kind" "$blob" "$app" >> "$f.new"
    chown "$RUNNER:$RUNNER" "$f.new"; chmod 600 "$f.new"; mv "$f.new" "$f"; echo "authorized the CI key of $app (forced command, restrict)" ;;
  status)
    echo "node: $(/opt/starci-node/bin/node --version 2>/dev/null || echo none)  sops: $(/usr/local/bin/sops --version 2>/dev/null | awk 'NR==1{print $2}' || echo none)"
    id "$RUNNER" 2>/dev/null || echo "no account $RUNNER"
    ls -l /usr/local/sbin/starci-deploy-* /etc/sudoers.d/90-starci-runner 2>/dev/null || true
    echo "apps: $(tr '\n' ' ' < "$ETC/apps" 2>/dev/null)"
    for a in $(cat "$ETC/apps" 2>/dev/null); do ls -l "$ETC/$a.conf" "$ETC/$a/" 2>/dev/null | awk '{print $1, $NF}'; done
    awk '{print $1, $NF}' "$RUNNER_HOME/.ssh/authorized_keys" 2>/dev/null | sed 's/^restrict,command=[^ ]*/restrict,forced/' || true
    tail -n 5 /var/log/starci-runner/runs.log 2>/dev/null || true ;;
  uninstall)
    rm -f /etc/sudoers.d/90-starci-runner /usr/local/sbin/starci-deploy-gate /usr/local/sbin/starci-deploy-run
    if id "$RUNNER" > /dev/null 2>&1; then userdel -r "$RUNNER" 2>/dev/null || userdel "$RUNNER"; fi
    rm -rf "$ETC" /var/lib/starci-runner
    if [ "${1:-}" = --all ]; then rm -rf /opt/starci-node /opt/starci-node-*; rm -f /usr/local/bin/sops; fi
    echo "uninstalled the runner (logs kept in /var/log/starci-runner)" ;;
  *) sed -n '2,13p' "$0" 2>/dev/null || true; exit 2 ;;
esac
