// server-key.mjs - `starci app secret server-key --env <env> [--rotate | --backup github | --restore github] [--execute]`: the deploy
// server's own age identity, made ON the server and never leaving it, and the environment sealed to it (ruling
// app-secrets-one-standard, contexts/project/stacks.md PROJECT-STACKS-5).
//   (none)     the server keeps SERVER_AGE_IDENTITY when it exists, else age-keygen makes it there (umask 077, mode 600, owner
//              root); only `age-keygen -y` (the public recipient) comes back. Locally the recipient joins the environment's rule
//              beside the owner key, is recorded as deploy.remote.serverRecipient, and every member is wrapped again (sops
//              updatekeys: the owner identity opens the data key only, no value is decrypted).
//   --rotate   a new identity is staged at <identity>.next, the members are wrapped to it, the server swaps it in keeping the old
//              file as <identity>.retired-<UTC stamp> until the owner deletes it, then the old recipient leaves the rule.
//   --backup github   the identity streams from the server's ssh stdout into `gh secret set SOPS_AGE_KEY --env <env>` of the
//              app's origin repository: the protected GitHub Environment <env> holds it as SOPS_AGE_KEY, the secret every CI job
//              bound to <env> (environment: <env>) reads to open that environment's members; never printed, held or written locally.
//   --restore github  dispatches the managed .github/workflows/stack-key-restore.yml, which writes that secret back to the server
//              only when its public key is the recorded deploy.remote.serverRecipient.
// Both GitHub actions warn when the repository itself holds a SOPS_AGE_KEY secret (names only): a job bound to no environment
// reads it, and the owner key never belongs in GitHub.
// The server is reached only through the deploy's own transport (remote.mjs withRunner): the same host, user and key source.
// Every effect is a dry run until --execute.
import path from 'node:path';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { readFileSync } from 'node:fs';
import { configuredRecipients, environmentRecipients } from '../runtime/scripts/hfs/secret-init.mjs';
import { recordServerRecipient } from '../runtime/scripts/hfs/secret-standard.mjs';
import { sealedFiles } from '../runtime/scripts/hfs/secret-store.mjs';
import { github } from '../ci/github.mjs';
import { AGE_INSTALL, installAge } from './age-install.mjs';
import { STACKS_DIR, STACKS_FILE, loadDeployConfig } from './config.mjs';
import type { DeployConfig } from './config.mjs';
import { firstLine } from './context.mjs';
import type { Sops, StackContext } from './context.mjs';
import { failure, refusal } from './errors.mjs';
import { shellQuote, withRunner } from './remote.mjs';
import type { ActionResult, RemoteResult, Runner, RunnerDeps } from './remote.mjs';

/** The gh port of ci/github.mjs that server-key reads and writes through. */
export interface GithubPort {
  repository(): string;
  // reason: gh api output, parsed JSON whose shape the callers narrow with the interfaces below
  json(args: string[]): any;
  run(args: string[]): unknown;
}

/** The collaborators the specs inject. */
export interface ServerKeyDeps extends RunnerDeps {
  github?: GithubPort;
  ghCommand?: { command: string; args: string[] };
}

/** The action a server-key call performs. */
export interface ServerKeyOptions {
  execute?: boolean | undefined;
  rotate?: boolean | undefined;
  backup?: string | undefined;
  restore?: string | undefined;
}

/** The parts of a GitHub Environment that decide whether it is protected. */
interface EnvironmentInfo {
  protection_rules?: { type?: string; reviewers?: unknown[] }[];
  deployment_branch_policy?: { custom_branch_policies?: boolean };
}
/** The deployment branch policies of a GitHub Environment. */
interface BranchPolicies { branch_policies?: { name?: string; type?: string }[] }
/** The repository secrets listing. */
interface SecretsListing { secrets?: { name?: string }[] }

/** The part of a remote result that names a recipient. */
type ScriptResult = Pick<RemoteResult, 'status' | 'stdout' | 'stderr'>;

/**
 * The deploy server's age identity: sops' default key file of root, so a decrypt on the server reads it with nothing set, and
 * SOPS_AGE_KEY_FILE names it where one is set. The one owner of this path; the restore workflow is rendered from it.
 */
export const SERVER_AGE_IDENTITY = '/root/.config/sops/age/keys.txt';

/** The managed workflow `--restore github` dispatches (templates/app/ci-workflows*). */
export const RESTORE_WORKFLOW = 'stack-key-restore.yml';

const RECIPIENT = /^age1[a-z0-9]+$/u;
/** A command run as root: directly when the deploy user is root, else over passwordless sudo, the script read from stdin. */
const AS_ROOT = 'if [ "$(id -u)" -eq 0 ]; then sh -s; else sudo -n sh -s; fi';

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

/**
 * The GitHub Environment secret that holds an environment's server identity. It carries the name the deploy workflows read
 * (secrets.SOPS_AGE_KEY), scoped to the Environment <env>: for a job bound to <env> it overrides a repository secret of that name.
 */
export const BACKUP_SECRET = 'SOPS_AGE_KEY';

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

/** The one remote command that streams `file` to stdout as root; only --backup github runs it, into the stdin of gh. */
export const streamIdentityCommand = (file: string): string =>
  `if [ "$(id -u)" -eq 0 ]; then cat -- ${shellQuote(file)}; else sudo -n cat -- ${shellQuote(file)}; fi`;

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

/**
 * The GitHub Environment that holds the backup, refused unless it exists in the app's origin repository and is protected: required
 * reviewers, or deployment branches limited to main. Names what is missing.
 */
export function protectedEnvironment(gh: GithubPort, env: string): string {
  let repo: string;
  try { repo = gh.repository(); } catch { throw refusal('STACK_SERVER_KEY_GITHUB', 'the app\'s origin repository cannot be read with gh (gh repo view); authenticate gh in the app checkout'); }
  let environment: EnvironmentInfo | null;
  try { environment = gh.json(['api', `repos/${repo}/environments/${env}`]); } catch {
    throw refusal('STACK_SERVER_KEY_GITHUB_ENVIRONMENT', `the GitHub Environment ${env} of ${repo} does not exist or cannot be read; create it with required reviewers or deployment branches limited to main`);
  }
  const reviewers = (environment?.protection_rules ?? []).some((rule) => rule?.type === 'required_reviewers' && (rule.reviewers ?? []).length > 0);
  let mainOnly = false;
  if (environment?.deployment_branch_policy?.custom_branch_policies === true) {
    const policies = (gh.json(['api', `repos/${repo}/environments/${env}/deployment-branch-policies`]) as BranchPolicies | null)?.branch_policies ?? [];
    mainOnly = policies.length > 0 && policies.every((policy) => policy?.name === 'main' && (policy.type ?? 'branch') === 'branch');
  }
  if (!reviewers && !mainOnly)
    throw refusal('STACK_SERVER_KEY_UNPROTECTED', `the GitHub Environment ${env} of ${repo} has no protection rule: it has no required reviewers and its deployment branches are not limited to main; add either before it holds the server identity`);
  return repo;
}

/**
 * The warning lines about a repository-level SOPS_AGE_KEY of `repo`, read by name only (gh api repos/<repo>/actions/secrets): a job
 * bound to no Environment, or to one without its own SOPS_AGE_KEY, reads that one. Empty when the repository holds none.
 */
export function repositoryKeyWarnings(gh: GithubPort, repo: string): string[] {
  let names: (string | undefined)[];
  try {
    names = ((gh.json(['api', `repos/${repo}/actions/secrets?per_page=100`]) as SecretsListing | null)?.secrets ?? []).map((secret) => secret?.name);
  } catch {
    return [`warning: the repository secret names of ${repo} cannot be read (gh api repos/${repo}/actions/secrets needs admin access); make sure the repository holds no ${BACKUP_SECRET} of its own`];
  }
  if (!names.includes(BACKUP_SECRET)) return [];
  return [`warning: ${repo} holds a repository secret ${BACKUP_SECRET}; a job bound to no Environment, or to one without its own ${BACKUP_SECRET}, reads it. Once every environment holds its server key (server-key --env <env> --backup github --execute), delete it: gh secret delete ${BACKUP_SECRET} --repo ${repo}. The owner key never belongs in GitHub.`];
}

async function backupKey(ctx: StackContext, config: DeployConfig, { execute }: ServerKeyOptions, deps: ServerKeyDeps): Promise<ActionResult> {
  const gh = deps.github ?? github({ cwd: config.repoRoot, env: ctx.env });
  const repo = protectedEnvironment(gh, config.env);
  const warnings = repositoryKeyWarnings(gh, repo);
  const sinkArgs = ['secret', 'set', BACKUP_SECRET, '--env', config.env, '--repo', repo];
  const plan = `stream ${SERVER_AGE_IDENTITY} from the server's ssh stdout into gh ${sinkArgs.join(' ')} (the ${config.env} Environment's ${BACKUP_SECRET}, which every job bound to ${config.env} reads; never printed, held or written locally)`;
  const data = { env: config.env, repo, secret: BACKUP_SECRET, repositorySecret: warnings.length > 0, execute };
  if (!execute) return { ok: true, lines: [`dry run: would ${plan} (--execute)`, ...warnings], data };
  return withRunner(ctx, config, {}, deps, async (run, notes): Promise<ActionResult> => {
    const source = run.argv(streamIdentityCommand(SERVER_AGE_IDENTITY));
    const sink = deps.ghCommand ?? { command: 'gh', args: [] };
    const piped = await ctx.pipe(source, { command: sink.command, args: [...sink.args, ...sinkArgs], env: ctx.env, cwd: config.repoRoot });
    if (piped.source !== 0) throw failure('STACK_SERVER_KEY_BACKUP', `the server could not stream ${SERVER_AGE_IDENTITY} (exit ${piped.source}); nothing was stored`);
    if (piped.sink !== 0) throw failure('STACK_SERVER_KEY_BACKUP', `gh secret set ${BACKUP_SECRET} failed (exit ${piped.sink}): ${piped.stderr}`);
    return { ok: true, lines: [...notes, `stored the server identity of ${config.env} as the secret ${BACKUP_SECRET} of the GitHub Environment ${config.env} of ${repo}`, ...warnings], data };
  });
}

async function restoreKey(ctx: StackContext, config: DeployConfig, { execute }: ServerKeyOptions, deps: ServerKeyDeps): Promise<ActionResult> {
  const recipient = config.remote.serverRecipient;
  if (!recipient)
    throw refusal('STACK_SERVER_KEY_NO_RECIPIENT', `environments.${config.env}.deploy.remote records no serverRecipient, so the restore cannot tell the server key from another identity: starci app secret server-key --env ${config.env} --execute records it`);
  const gh = deps.github ?? github({ cwd: config.repoRoot, env: ctx.env });
  const repo = protectedEnvironment(gh, config.env);
  const warnings = repositoryKeyWarnings(gh, repo);
  const args = ['workflow', 'run', RESTORE_WORKFLOW, '--repo', repo, '-f', `environment=${config.env}`, '-f', `recipient=${recipient}`];
  const data = { env: config.env, repo, recipient, repositorySecret: warnings.length > 0, execute };
  if (!execute) return { ok: true, lines: [`dry run: would run gh ${args.join(' ')}; the workflow writes the ${config.env} Environment's ${BACKUP_SECRET} to ${SERVER_AGE_IDENTITY} on the server when none is there and its public key is ${recipient} (--execute)`, ...warnings], data };
  try { gh.run(args); } catch { throw failure('STACK_SERVER_KEY_RESTORE', `gh could not dispatch ${RESTORE_WORKFLOW} in ${repo}; is the managed workflow rendered (starci app sync --execute) and pushed?`); }
  return { ok: true, lines: [`dispatched ${RESTORE_WORKFLOW} in ${repo} for ${config.env}; follow it with gh run list --workflow ${RESTORE_WORKFLOW} --repo ${repo}`, ...warnings], data };
}

/**
 * Runs one server-key action. `options`: { execute, rotate, backup, restore };
 * `deps` (specs): { ssh (an injected runner), github (the gh port of ci/github.mjs), ghCommand ({ command, args } the pipe's sink) }.
 */
export async function serverKey(ctx: StackContext, env: string, options: ServerKeyOptions, deps: ServerKeyDeps = {}): Promise<ActionResult> {
  const config = loadDeployConfig({ repoRoot: ctx.cwd, env });
  declaredRemote(ctx.cwd, env);
  const named: [string, string | undefined][] = [['backup', options.backup], ['restore', options.restore]];
  for (const [flag, value] of named)
    if (value !== undefined && value !== 'github') throw refusal('STACK_USAGE', `--${flag} takes github`);
  if ([options.rotate === true, options.backup !== undefined, options.restore !== undefined].filter(Boolean).length > 1)
    throw refusal('STACK_USAGE', '--rotate, --backup and --restore are separate actions; pass one');
  if (options.backup) return backupKey(ctx, config, options, deps);
  if (options.restore) return restoreKey(ctx, config, options, deps);
  if (options.rotate) return rotateKey(ctx, config, options, deps);
  return ensureKey(ctx, config, options, deps);
}
