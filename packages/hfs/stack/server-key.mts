// server-key.mts - `starci app secret server-key --env <env> [--rotate] [--execute]`: the deploy
// server's own age identity, made ON the server and never leaving it, and the environment sealed to it
// (contexts/project/stacks.md PROJECT-STACKS-5).
//   (none)     the server keeps SERVER_AGE_IDENTITY when it exists, else age-keygen makes it there (umask 077, mode 600, owner
//              root); only `age-keygen -y` (the public recipient) comes back. Locally the recipient joins the environment's rule
//              beside the owner key, is recorded as deploy.remote.serverRecipient, and every member is wrapped again (sops
//              updatekeys: the owner identity opens the data key only, no value is decrypted).
//   --rotate   a new identity is staged at <identity>.next, the members are wrapped to it, the server swaps it in keeping the old
//              file as <identity>.retired-<UTC stamp> until the owner deletes it, then the old recipient leaves the rule.
//   --backup   refused: the server key is never copied into a repository. Its break-glass backup lives only in the harness
//              repository's break-glass environment; an app's CI reads its own CI key (a recipient of the environment) instead.
// The server is reached only through the deploy's own transport (remote.mts withRunner): the same host, user and key source.
// Every effect is a dry run until --execute.
import path from 'node:path';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { readFileSync } from 'node:fs';
import { configuredRecipients, environmentRecipients } from '../runtime/scripts/hfs/secret-init.mjs';
import { recordServerRecipient } from '../runtime/scripts/hfs/secret-standard.mjs';
import { sealedFiles } from '../runtime/scripts/hfs/secret-store.mjs';
import { AGE_INSTALL, installAge } from './age-install.mjs';
import { STACKS_DIR, STACKS_FILE, loadDeployConfig } from './config.mjs';
import type { DeployConfig } from './config.mjs';
import { firstLine } from './context.mjs';
import type { Sops, StackContext } from './context.mjs';
import { failure, refusal } from './errors.mjs';
import { shellQuote, withRunner } from './remote.mjs';
import type { ActionResult, RemoteResult, Runner, RunnerDeps } from './remote.mjs';

/** The collaborators the specs inject. */
export type ServerKeyDeps = RunnerDeps;

/** The action a server-key call performs. */
export interface ServerKeyOptions {
  execute?: boolean | undefined;
  rotate?: boolean | undefined;
}

/** The part of a remote result that names a recipient. */
type ScriptResult = Pick<RemoteResult, 'status' | 'stdout' | 'stderr'>;

/**
 * The deploy server's age identity: sops' default key file of root, so a decrypt on the server reads it with nothing set, and
 * SOPS_AGE_KEY_FILE names it where one is set. The one owner of this path.
 */
export const SERVER_AGE_IDENTITY = '/root/.config/sops/age/keys.txt';

const RECIPIENT = /^age1[a-z0-9]+$/u;
/** A command run as root: directly when the deploy user is root, else over passwordless sudo, the script read from stdin. */
export const AS_ROOT = 'if [ "$(id -u)" -eq 0 ]; then sh -s; else sudo -n sh -s; fi';

/**
 * The directories, after root's PATH, where age-keygen is looked for: sudo's secure_path (AlmaLinux 10, RHEL) leaves out
 * /usr/local/bin, where the static installer puts it, so the presence check and every call resolve it the same way, as root.
 */
export const AGE_KEYGEN_DIRS = ['/usr/local/bin', '/usr/bin', '/bin'];

/** The shell lines that set k to age-keygen's absolute path as root sees it, or exit 127 naming it missing. Every root script holds them. */
export const RESOLVE_AGE_KEYGEN = [
  'k="$(command -v age-keygen 2>/dev/null || true)"',
  `for d in ${AGE_KEYGEN_DIRS.join(' ')}; do if [ -z "$k" ] && [ -x "$d/age-keygen" ]; then k="$d/age-keygen"; fi; done`,
  'if [ -z "$k" ]; then echo "age-keygen is not installed" >&2; exit 127; fi',
].join('\n');

/** The root script that only resolves age-keygen and prints its path: the presence check, run exactly as the calls run. */
export const ageKeygenScript = (): string => ['set -eu', RESOLVE_AGE_KEYGEN, String.raw`printf '%s\n' "$k"`].join('\n');

/** The shell that keeps `file` when it is an ordinary file, else makes it with age-keygen (umask 077), then prints only its public key. */
export function ensureIdentityScript(file: string): string {
  const quoted = shellQuote(file);
  return [
    'set -eu',
    'umask 077',
    RESOLVE_AGE_KEYGEN,
    `f=${quoted}`,
    'if [ -e "$f" ] || [ -L "$f" ]; then',
    '  if [ -L "$f" ] || [ ! -f "$f" ]; then echo "the identity path is not an ordinary file" >&2; exit 4; fi',
    '  echo "identity kept" >&2',
    'else',
    '  mkdir -p "$(dirname "$f")"',
    '  "$k" -o "$f" >/dev/null 2>&1',
    '  echo "identity created" >&2',
    'fi',
    'chown root:root "$f"',
    'chmod 600 "$f"',
    '"$k" -y "$f"',
  ].join('\n');
}

/** The shell that prints only the public key of `file`, or exits 5 when there is none. */
export function publicKeyScript(file: string): string {
  return ['set -eu', RESOLVE_AGE_KEYGEN, `f=${shellQuote(file)}`, '[ -f "$f" ] || exit 5', '"$k" -y "$f"'].join('\n');
}

/** The shell that swaps the staged `<file>.next` in, keeping the old identity as `retired`, then prints only the new public key. */
export function swapIdentityScript(file: string, retired: string): string {
  return [
    'set -eu',
    'umask 077',
    RESOLVE_AGE_KEYGEN,
    `f=${shellQuote(file)}`,
    `r=${shellQuote(retired)}`,
    'n="$f.next"',
    'if [ ! -f "$n" ] || [ -L "$n" ]; then echo "no staged identity" >&2; exit 4; fi',
    'if [ -e "$r" ]; then echo "the retired name is taken" >&2; exit 4; fi',
    'mv "$f" "$r"',
    'mv "$n" "$f"',
    'chmod 600 "$f" "$r"',
    '"$k" -y "$f"',
  ].join('\n');
}

/** The single public recipient a server script printed; anything else is refused without echoing a byte of it. */
function recipientOf(result: ScriptResult, what: string): string {
  const text = String(result.stdout ?? '').trim();
  if (result.status !== 0) throw failure('STACK_SERVER_KEY_REMOTE', `${what} failed on the server (exit ${result.status}): ${firstLine(result.stderr)}`);
  if (!RECIPIENT.test(text)) throw failure('STACK_SERVER_KEY_OUTPUT', `${what} printed something other than one public age recipient; none of it is shown`);
  return text;
}

/** The raw `environments.<env>.deploy.remote` block: the deploy's own transport, which this verb never invents. */
function declaredRemote(repoRoot: string, env: string): Record<string, unknown> {
  const declaration = parseYaml(readFileSync(path.join(repoRoot, STACKS_DIR, STACKS_FILE), 'utf8'));
  const remote = declaration?.environments?.[env]?.deploy?.remote;
  if (!remote || typeof remote !== 'object' || (remote.host === undefined && remote.sealed === undefined))
    throw refusal('STACK_SERVER_KEY_NO_REMOTE', `environments.${env}.deploy.remote of ${STACKS_FILE} declares no transport: add host (the ssh alias the deploy uses) or sealed (ops, sshKey, knownHosts); server-key reaches the server only the way the deploy does`);
  return remote;
}

/** True when root resolves age-keygen the way every server-key script does (ageKeygenScript). */
const hasKeygen = (run: Runner): boolean => asRoot(run, ageKeygenScript()).status === 0;

/**
 * Ensures age-keygen on the server, checked as root exactly as it is called: stack prepare's installer owns the install (with
 * --execute); without it the exact commands.
 */
function ensureTool(run: Runner, execute: boolean | undefined, lines: string[]): boolean {
  if (hasKeygen(run)) return true;
  const install = `install age on the server (one of: ${Object.values(AGE_INSTALL).join('; ')})`;
  if (!execute) { lines.push(`dry run: age-keygen is missing on the server; --execute installs it with stack prepare's installer, or ${install}`); return false; }
  const problems: string[] = [];
  installAge(run, { note: (text: string) => { lines.push(text); }, bad: (text: string) => { problems.push(text); } });
  if (problems.length || !hasKeygen(run))
    throw refusal('STACK_SERVER_KEY_NO_AGE', `age-keygen is not on the server and could not be installed (${problems.join('; ') || 'still missing'}): ${install}`);
  return true;
}

/** Wraps every member of the environment again to its rule (sops updatekeys); names only. */
function reseal(config: DeployConfig, seam: Sops, lines: string[]): void {
  const members = sealedFiles(config.secretsDir);
  for (const name of members) seam.updateKeys(path.join(config.secretsDir, name));
  lines.push(members.length ? `wrapped ${members.length} member${members.length === 1 ? '' : 's'} of ${config.env} again: ${members.join(', ')}` : `${config.env} has no sealed member yet`);
}

/** Puts `add` on the environment's rule and takes `remove` off it, every other recipient (the owner key) kept, then reseals. */
function sealTo(ctx: StackContext, config: DeployConfig, { add = [], remove = [] }: { add?: string[]; remove?: string[] }, lines: string[]): void {
  try {
    environmentRecipients(config.repoRoot, config.env, { add, remove, owner: () => { throw new Error('owner is not named here'); }, stdout: (text: string) => lines.push(text.trimEnd()) });
  } catch (error) {
    throw refusal('STACK_SERVER_KEY_RULE', (error as Error).message);
  }
  reseal(config, ctx.sops, lines);
}

/** The environment's rule must already name a recipient other than the server's (the owner key), which every seal keeps. */
function requireOwnerRecipient(config: DeployConfig, server: string[] = []): void {
  let rule: string[] = [];
  try { rule = configuredRecipients(config.repoRoot, path.join(config.secretsDir, 'member.enc.yaml')); } catch { rule = []; }
  if (!rule.some((recipient) => !server.includes(recipient)))
    throw refusal('STACK_SERVER_KEY_NO_OWNER', `the ${config.env} rule of .sops.yaml names no owner key, so the server key would be its only recipient: starci app secret recipients --env ${config.env} --add owner --execute`);
}

/** The members need the owner identity to be wrapped again: refused before the server is touched. */
function requireOwnerIdentity(ctx: StackContext, config: DeployConfig): void {
  const [first] = sealedFiles(config.secretsDir);
  if (first) ctx.sops.requireIdentity?.(path.join(config.secretsDir, first));
}

const asRoot = (run: Runner, script: string): RemoteResult => run(AS_ROOT, { input: script });

const retiredName = (ctx: Pick<StackContext, 'now'>): string => `${SERVER_AGE_IDENTITY}.retired-${new Date(ctx.now()).toISOString().replaceAll('-', '').replaceAll(':', '').slice(0, 15)}Z`;

async function ensureKey(ctx: StackContext, config: DeployConfig, { execute }: ServerKeyOptions, deps: ServerKeyDeps): Promise<ActionResult> {
  return withRunner(ctx, config, {}, deps, async (run, notes): Promise<ActionResult> => {
    const lines = [...notes];
    const tool = ensureTool(run, execute, lines);
    if (!execute) {
      const current: RemoteResult = tool ? asRoot(run, publicKeyScript(SERVER_AGE_IDENTITY)) : { status: 5, stdout: '', stderr: '' };
      if (current.status === 5) lines.push(`dry run: would create ${SERVER_AGE_IDENTITY} on the server (age-keygen, umask 077, mode 600, owner root) and read back only its public key`);
      else lines.push(`dry run: the server holds ${SERVER_AGE_IDENTITY} (${recipientOf(current, 'age-keygen -y')}); it is kept`);
      lines.push(`dry run: would add that recipient to the ${config.env} rule of .sops.yaml beside the owner key, record it as deploy.remote.serverRecipient and wrap every member of ${config.env} again (--execute)`);
      return { ok: true, lines, data: { env: config.env, identity: SERVER_AGE_IDENTITY, execute } };
    }
    requireOwnerIdentity(ctx, config);
    requireOwnerRecipient(config, [config.remote.serverRecipient].filter((recipient): recipient is string => Boolean(recipient)));
    const made = asRoot(run, ensureIdentityScript(SERVER_AGE_IDENTITY));
    const recipient = recipientOf(made, 'age-keygen');
    lines.push(`${String(made.stderr).includes('identity created') ? 'created' : 'kept'} ${SERVER_AGE_IDENTITY} on the server; public recipient ${recipient}`);
    sealTo(ctx, config, { add: [recipient] }, lines);
    recordServerRecipient(config.repoRoot, config.env, recipient);
    lines.push(`recorded environments.${config.env}.deploy.remote.serverRecipient: ${recipient}`);
    return { ok: true, lines, data: { env: config.env, identity: SERVER_AGE_IDENTITY, recipient, execute } };
  });
}

async function rotateKey(ctx: StackContext, config: DeployConfig, { execute }: ServerKeyOptions, deps: ServerKeyDeps): Promise<ActionResult> {
  return withRunner(ctx, config, {}, deps, async (run, notes): Promise<ActionResult> => {
    const lines = [...notes];
    if (!ensureTool(run, execute, lines)) return { ok: true, lines, data: { env: config.env, identity: SERVER_AGE_IDENTITY, execute } };
    const current = asRoot(run, publicKeyScript(SERVER_AGE_IDENTITY));
    if (current.status === 5) throw refusal('STACK_SERVER_KEY_NONE', `the server holds no ${SERVER_AGE_IDENTITY} to rotate: starci app secret server-key --env ${config.env} --execute`);
    const old = recipientOf(current, 'age-keygen -y');
    const retired = retiredName(ctx);
    if (!execute) {
      lines.push(`dry run: would stage a new identity at ${SERVER_AGE_IDENTITY}.next, wrap every member of ${config.env} to it beside ${old} and the owner key, swap it in keeping the old file as ${retired}, then remove ${old} from the rule (--execute)`);
      return { ok: true, lines, data: { env: config.env, identity: SERVER_AGE_IDENTITY, previous: old, execute } };
    }
    requireOwnerIdentity(ctx, config);
    requireOwnerRecipient(config, [old]);
    const next = recipientOf(asRoot(run, ensureIdentityScript(`${SERVER_AGE_IDENTITY}.next`)), 'age-keygen');
    lines.push(`staged ${SERVER_AGE_IDENTITY}.next on the server; public recipient ${next}`);
    sealTo(ctx, config, { add: [next] }, lines);
    recordServerRecipient(config.repoRoot, config.env, next);
    const swapped = recipientOf(asRoot(run, swapIdentityScript(SERVER_AGE_IDENTITY, retired)), 'the identity swap');
    if (swapped !== next) throw failure('STACK_SERVER_KEY_SWAP', `the server's identity reads ${swapped} after the swap, not the staged ${next}`);
    lines.push(`swapped the new identity in; the old one is kept on the server as ${retired} until the owner deletes it`);
    sealTo(ctx, config, { remove: old === next ? [] : [old] }, lines);
    lines.push(`recorded environments.${config.env}.deploy.remote.serverRecipient: ${next}; ${old} left the ${config.env} rule`);
    return { ok: true, lines, data: { env: config.env, identity: SERVER_AGE_IDENTITY, recipient: next, previous: old, retired, execute } };
  });
}

/** Why --backup is refused: the server key never leaves the server for an app repository. */
export const NO_REPOSITORY_BACKUP = 'the server key is never copied into a repository; its break-glass backup lives only in the harness repository\'s break-glass environment';

/**
 * Runs one server-key action. `options`: { execute, rotate } (a --backup is refused by the parser: NO_REPOSITORY_BACKUP);
 * `deps` (specs): { ssh (an injected runner) }.
 */
export async function serverKey(ctx: StackContext, env: string, options: ServerKeyOptions, deps: ServerKeyDeps = {}): Promise<ActionResult> {
  const config = loadDeployConfig({ repoRoot: ctx.cwd, env });
  declaredRemote(ctx.cwd, env);
  if (options.rotate) return rotateKey(ctx, config, options, deps);
  return ensureKey(ctx, config, options, deps);
}
