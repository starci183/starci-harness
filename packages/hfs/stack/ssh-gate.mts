// ssh-gate.mjs - the forced command of the CI SSH key on the manager (`starci-ssh-gate`) and the named operations it admits.
// The CI key reaches the manager's Docker socket, which is root on that host; its line in authorized_keys is therefore
//   restrict,command="starci-ssh-gate" ssh-ed25519 AAAA... <comment>
// and the gate admits exactly two kinds of request:
//   `docker system dial-stdio`                   the transport of DOCKER_HOST=ssh://<alias> (the docker CLI starts it itself)
//   `starci-op <name> <argument>...`             one of the named operations below, each argument validated by its kind
// Everything else - a shell, an unknown name, a wrong argument count, an argument outside its closed alphabet - is refused with exit 126 and no echo of
// the request. The operations are the release store's remote protocol (release-store.mts): the same script bodies run for the owner's key (through
// `sh -c`, without the gate) and for the CI key (through the gate), so the gate admits no script the store does not itself run.
// A body reads its arguments as $1... ($0 is `starci-op`) and its stdin; it holds no free text.
import { refusal } from './errors.mjs';
import { shellQuote } from './remote.mjs';

/** What an argument is: each kind is a closed alphabet, checked by the client (TypeScript) and by the gate (POSIX sh) alike. */
export type ArgKind = 'base' | 'release' | 'pointer' | 'token' | 'trigger' | 'attempt' | 'seconds';

/** One named operation: its arguments by kind, whether it reads stdin, and the sh body that runs with the arguments as $1.... */
export interface GateOp { readonly name: string; readonly args: readonly ArgKind[]; readonly stdin: boolean; readonly body: string }

const RELEASE_ID = /^[0-9a-f]{16}$/u;
const TOKEN = /^[0-9a-f]{32}$/u;
const ATTEMPT = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$/u;
const BASE = /^\/[A-Za-z0-9._/-]+$/u;

/** The closed alphabet of each argument kind. */
export const ARG_TESTS: Readonly<Record<ArgKind, (value: string) => boolean>> = Object.freeze({
  base: (value) => BASE.test(value) && !value.includes('..'),
  release: (value) => RELEASE_ID.test(value),
  pointer: (value) => value === 'current' || value === 'previous',
  token: (value) => TOKEN.test(value),
  trigger: (value) => value === 'ci' || value === 'dispatch' || value === 'urgent',
  attempt: (value) => ATTEMPT.test(value),
  seconds: (value) => /^[0-9]{1,6}$/u.test(value),
});

const OWNER_READ = 'if [ -r "$l/owner" ]; then read -r held_token held_trigger held_stamp < "$l/owner"; else held_token=none; held_trigger=unknown; held_stamp=$(stat -c %Y "$l" 2>/dev/null) || held_stamp=0; fi; case "$held_stamp" in \'\'|*[!0-9]*) held_stamp=0;; esac';

/** Prints the release the pointer `$2` under `$1` names, or an empty line for an absent link; a failing readlink fails the script. */
const POINTER = 'if [ -L "$1/$2" ]; then basename "$(readlink "$1/$2")"; else printf \'\\n\'; fi';

/**
 * The named operations of the release store. `lock-acquire`: `mkdir` is the atomic claim, the owner file (token, trigger, epoch) is replaced by
 * rename, a lock unrefreshed for $4 seconds is moved aside (one rename wins) and claimed anew; prints `acquired` or `busy <trigger> <age>`.
 */
export const GATE_OPS: readonly GateOp[] = Object.freeze([
  { name: 'pointer', args: ['base', 'pointer'], stdin: false, body: POINTER },
  { name: 'list', args: ['base'], stdin: false, body: `for n in current previous; do if [ -L "$1/$n" ]; then basename "$(readlink "$1/$n")"; else printf '\\n'; fi; done; if [ -d "$1/releases" ]; then ls -1t "$1/releases"; fi` },
  { name: 'read', args: ['base', 'release'], stdin: false, body: `set -e; s="$1/releases/$2"; for f in stack.yaml release.json; do test -r "$s/$f"; base64 < "$s/$f" | tr -d '\\n'; printf '\\n'; done` },
  { name: 'store', args: ['base', 'release'], stdin: true, body: 'set -e; d="$1/releases/$2"; if [ -d "$d" ]; then chmod -R u+w "$d"; else mkdir -p "$d"; fi; IFS= read -r stack; IFS= read -r release; printf \'%s\' "$stack" | base64 -d > "$d/stack.yaml"; printf \'%s\' "$release" | base64 -d > "$d/release.json"; chmod 440 "$d/stack.yaml" "$d/release.json"; chmod 550 "$d"' },
  { name: 'accept', args: ['base', 'release'], stdin: false, body: 'set -e; cd "$1"; id="$2"; test -d "releases/$id"; if [ -L current ] && [ "$(basename "$(readlink current)")" != "$id" ]; then ln -sfn "$(readlink current)" previous; fi; ln -sfn "releases/$id" current.new; mv -Tf current.new current' },
  {
    name: 'lock-acquire', args: ['base', 'token', 'trigger', 'seconds'], stdin: false,
    body: [
      'b="$1"; tok="$2"; trg="$3"; ttl="$4"; l="$b/deploy.lock"; now=$(date +%s); mkdir -p "$b" || exit 1',
      'claim() { printf \'%s %s %s\\n\' "$tok" "$trg" "$now" > "$l/owner.new" && mv -f "$l/owner.new" "$l/owner" && echo acquired && exit 0; exit 1; }',
      'if mkdir "$l" 2>/dev/null; then claim; fi',
      OWNER_READ,
      'age=$((now - held_stamp)); if [ "$age" -gt "$ttl" ]; then if mv "$l" "$l.stale.$tok" 2>/dev/null; then rm -rf "$l.stale.$tok"; if mkdir "$l" 2>/dev/null; then claim; fi; fi; fi',
      'case "$held_trigger" in ci|dispatch|urgent) ;; *) held_trigger=unknown;; esac; echo "busy $held_trigger $age"',
    ].join('; '),
  },
  { name: 'lock-refresh', args: ['base', 'token'], stdin: false, body: 'l="$1/deploy.lock"; now=$(date +%s); if [ -r "$l/owner" ]; then read -r t g s < "$l/owner"; if [ "$t" = "$2" ]; then printf \'%s %s %s\\n\' "$t" "$g" "$now" > "$l/owner.new" && mv -f "$l/owner.new" "$l/owner" && echo held; else echo lost; fi; else echo lost; fi' },
  { name: 'lock-release', args: ['base', 'token'], stdin: false, body: 'l="$1/deploy.lock"; if [ -r "$l/owner" ]; then read -r t g s < "$l/owner"; if [ "$t" = "$2" ]; then rm -rf "$l" && echo released; else echo lost; fi; else echo lost; fi' },
  { name: 'journal-write', args: ['base', 'attempt'], stdin: true, body: 'set -e; d="$1/deploys"; mkdir -p "$d"; IFS= read -r doc; printf \'%s\' "$doc" | base64 -d > "$d/.$2.tmp"; mv -f "$d/.$2.tmp" "$d/$2.json"' },
  { name: 'journal-index', args: ['base'], stdin: true, body: 'set -e; mkdir -p "$1/deploys"; IFS= read -r line; printf \'%s\\n\' "$(printf \'%s\' "$line" | base64 -d)" >> "$1/deploys.jsonl"' },
  // The newest 500 attempt documents, one base64 line each, oldest first (attempt ids sort by their UTC time).
  { name: 'journal-read', args: ['base'], stdin: false, body: 'd="$1/deploys"; [ -d "$d" ] || exit 0; names=$(ls -1 "$d") || exit 1; printf \'%s\\n\' "$names" | tail -n 500 | while IFS= read -r f; do case "$f" in ' + `${'[0-9]'.repeat(8)}T${'[0-9]'.repeat(6)}Z-${'[0-9a-f]'.repeat(8)}.json` + ') base64 < "$d/$f" | tr -d \'\\n\'; printf \'\\n\';; esac; done' },
]);

const BY_NAME: ReadonlyMap<string, GateOp> = new Map(GATE_OPS.map((op) => [op.name, op]));

/** The operation called `name`; an unknown name is a defect of the caller. */
export function gateOp(name: string): GateOp {
  const op = BY_NAME.get(name);
  if (!op) throw refusal('STACK_GATE_OP', `${name} is not an operation of the ssh gate`);
  return op;
}

function checkedArguments(op: GateOp, args: readonly string[]): readonly string[] {
  if (args.length !== op.args.length) throw refusal('STACK_GATE_ARGUMENT', `${op.name} takes ${op.args.length} argument(s)`);
  op.args.forEach((kind, index) => {
    if (!ARG_TESTS[kind](args[index] as string)) throw refusal('STACK_GATE_ARGUMENT', `argument ${index + 1} of ${op.name} is not a plain ${kind}`);
  });
  return args;
}

/** The command the CI transport sends: `starci-op <name> <argument>...` (every argument is plain characters, so nothing needs quoting). */
export function gatedCommand(name: string, args: readonly string[]): string {
  const op = gateOp(name);
  return ['starci-op', op.name, ...checkedArguments(op, args)].join(' ');
}

/** The same operation as one command for a key without the gate: the body under `sh -c` with the arguments as positional parameters. */
export function inlineCommand(name: string, args: readonly string[]): string {
  const op = gateOp(name);
  return `sh -c ${shellQuote(op.body)} starci-op ${checkedArguments(op, args).map(shellQuote).join(' ')}`;
}

const VALIDATOR = Object.freeze({
  base: 'v_base', release: 'v_release', pointer: 'v_pointer', token: 'v_token', trigger: 'v_trigger', attempt: 'v_attempt', seconds: 'v_seconds',
} satisfies Record<ArgKind, string>);

/** The sh variable that holds the body of an operation. */
const bodyVariable = (name: string): string => `OP_${name.replaceAll('-', '_')}`;

/** The POSIX sh text of `starci-ssh-gate`, to install executable at /usr/local/bin/starci-ssh-gate on the manager. */
export function gateScript(): string {
  const digits = (count: number, set = '[0-9]'): string => set.repeat(count);
  const bodies = GATE_OPS.map((op) => `${bodyVariable(op.name)}=${shellQuote(op.body)}`);
  const cases = GATE_OPS.map((op) => {
    const checks = op.args.map((kind, index) => `${VALIDATOR[kind]} "$${index + 1}"`).join(' && ');
    return `  ${op.name}) [ $# -eq ${op.args.length} ]${checks ? ` && ${checks}` : ''} || refuse; exec sh -c "$${bodyVariable(op.name)}" starci-op "$@";;`;
  });
  return [
    '#!/bin/sh',
    '# starci-ssh-gate: the forced command of the CI key (generated by `starci app stack ci-key --print-gate`; do not edit, regenerate).',
    '# Admits `docker system dial-stdio` and the named operations of the release store, nothing else. A refusal says nothing about the request.',
    'PATH="$PATH:/usr/local/bin:/usr/bin:/bin"',
    "refuse() { echo 'starci-ssh-gate: command refused' >&2; exit 126; }",
    'v_base() { case "$1" in /*) ;; *) return 1;; esac; case "$1" in *[!A-Za-z0-9._/-]*|*..*) return 1;; esac; }',
    'v_hex() { case "$2" in \'\'|*[!0-9a-f]*) return 1;; esac; [ "${#2}" -eq "$1" ]; }',
    'v_release() { v_hex 16 "$1"; }',
    'v_token() { v_hex 32 "$1"; }',
    'v_pointer() { case "$1" in current|previous) ;; *) return 1;; esac; }',
    'v_trigger() { case "$1" in ci|dispatch|urgent) ;; *) return 1;; esac; }',
    `v_attempt() { case "$1" in ${digits(8)}T${digits(6)}Z-${digits(8, '[0-9a-f]')}) ;; *) return 1;; esac; v_hex 8 "\${1#*Z-}"; }`,
    'v_seconds() { case "$1" in \'\'|*[!0-9]*) return 1;; esac; [ "${#1}" -le 6 ]; }',
    ...bodies,
    'cmd=${SSH_ORIGINAL_COMMAND-}',
    '[ -n "$cmd" ] || refuse',
    'if [ "$cmd" = \'docker system dial-stdio\' ]; then exec docker system dial-stdio; fi',
    "IFS=' '; set -f",
    'set -- $cmd',
    '[ $# -ge 2 ] && [ "$1" = starci-op ] || refuse',
    'op=$2; shift 2',
    'case "$op" in',
    ...cases,
    '  *) refuse;;',
    'esac',
    '',
  ].join('\n');
}

/** True when the CI transport was set up for a key that has the gate (`connect` exports STARCI_SSH_GATE=1 for a sealed `vps-ci` member that says `VPS_GATE: "1"`). */
export const gateIsOn = (env: NodeJS.ProcessEnv | undefined): boolean => env?.STARCI_SSH_GATE === '1';

/** Where the gate is installed on the manager, and the forced-command word of the authorized_keys line. */
export const GATE_PATH = '/usr/local/bin/starci-ssh-gate';

/** The options of the CI key's line: `restrict` already denies everything optional; the explicit denials keep the line readable and survive a reader who forgets what `restrict` covers. */
export const AUTHORIZED_OPTIONS = Object.freeze(['restrict', 'command="starci-ssh-gate"', 'no-pty', 'no-port-forwarding', 'no-agent-forwarding', 'no-X11-forwarding', 'no-user-rc']);

const KEY_LINE = /^(ssh-ed25519|ecdsa-sha2-nistp(?:256|384|521)|ssh-rsa|sk-ssh-ed25519@openssh\.com) [A-Za-z0-9+/]+={0,3}(?: [A-Za-z0-9._@:+=-]+)?$/u;

/**
 * The authorized_keys line of the CI key from its PUBLIC key text. Only a one-line public key is accepted (a private key, a line that already carries options
 * or a second line is refused); the key keeps the comment it was generated with, which names it for revocation.
 */
export function authorizedKeysLine(publicKey: string): string {
  const text = publicKey.trim();
  if (text.includes('PRIVATE KEY')) throw refusal('STACK_CI_KEY_PRIVATE', 'that is a private key: give the public half (.pub) of the CI key');
  if (!KEY_LINE.test(text)) throw refusal('STACK_CI_KEY_PUBLIC', 'the CI public key must be one line: <type> <base64> [comment], with no options in front');
  return `${AUTHORIZED_OPTIONS.join(',')} ${text}`;
}
