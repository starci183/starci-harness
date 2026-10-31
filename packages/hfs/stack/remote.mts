// remote.mjs - how the stack verbs reach the Swarm manager: the ssh runner, remote command quoting, the CI transport setup.
//   sshRunner(ctx, config, { sshCmd })  -> run(command, { input }) -> { status, stdout, stderr }   (`.cleanup()`, `.notes`, `.argv(command)`:
//                                          the { command, args, env } a caller spawns itself to stream the remote stdout)
//   transports, in this order: --ssh-cmd "ssh vps" (no shell) -> the owner-machine session opened from the sealed members
//   (only when config.remote.sealed is declared and STARCI_STACK_SEALED_SSH=1) -> the ssh alias config.remote.host (CI after `connect`,
//   or the operator's own ssh config).
//   connectCi / disconnectCi            GitHub Actions: write and remove the pinned key, known_hosts, ssh config and DOCKER_HOST.
// A remote command is ONE ssh argument with every carriage return removed (lfOnly: a script that reached a Windows checkout with CRLF made
// `bash -s` fail with `set: pipefail`). Key material lives in memory and in a private temp directory only; it is never in argv (only the key
// FILE path is), in a line, in a result or in an error message.
import fs from 'node:fs';
import { isLegacyName, memberFile } from '../runtime/scripts/lib/sealed-member.mjs';
import os from 'node:os';
import path from 'node:path';
import type { DeployConfig, SealedRemote } from './config.mjs';
import { tool } from './context.mjs';
import type { RunResult, StackContext } from './context.mjs';
import { restrictToUser, writePrivate } from './private-file.mjs';
import { refusal } from './errors.mjs';
import { openMember as openSealedMember } from './sealed.mjs';
import { createSshSession, sessionDirectory } from './ssh-session.mjs';
import type { Argv, RemoteArgv, SshConnection } from './ssh-session.mjs';
import { assertStackAccount } from './target-binding.mjs';

/** The outcome of one remote command. */
export interface RemoteResult { status: number; stdout: string; stderr: string }

/** `run(command, { input })`: runs one shell command on the manager (see the top of the file). */
export interface Runner {
  (command: string, options?: { input?: string | undefined }): RemoteResult;
  cleanup: () => unknown;
  notes: string[];
  argv: (command: string) => RemoteArgv;
}

/** Where a verb gets its runner: `deps.ssh` wins in specs. */
export interface RunnerDeps { ssh?: Runner | undefined }

/** The options every action receives from the CLI to reach the manager. */
export interface SshOptions { sshCmd?: string | null | undefined }

/** The shape every action returns: `{ ok, lines, data }`; `refused` is set by a failed floor step of an urgent deploy. */
export interface ActionResult<D extends object = Record<string, unknown>> {
  ok: boolean;
  lines: string[];
  data?: D | undefined;
  refused?: { code: string; message: string } | undefined;
}

const ACCOUNT = /^[A-Za-z0-9._@-]+$/u;
const CI_VARIABLES = ['VPS_SSH_KEY', 'VPS_KNOWN_HOSTS', 'VPS_HOST', 'VPS_USER'];
const SSH_OPTIONS = ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20'];

/** Removes every carriage return. */
export const lfOnly = (text: unknown): string => String(text).replaceAll('\r', '');

/** POSIX single-quote quoting; NUL and line breaks cannot be quoted safely and are refused. */
export function shellQuote(value: unknown): string {
  const text = String(value);
  if (text.includes('\0') || /[\r\n]/u.test(text)) throw refusal('STACK_REMOTE_ARGUMENT', 'a remote argument must not contain NUL or a line break');
  return ["'", text.replaceAll("'", String.raw`'\''`), "'"].join('');
}

/**
 * The shell that prints the release the symlink `name` under `quotedBase` (an already-quoted directory) points at, one line; an absent link prints an
 * empty line and succeeds. Only the absent link is expected: a `readlink` or `basename` that fails fails the script, and the caller reports it.
 */
export const releasePointerScript = (quotedBase: string, name: string): string => `if [ -L ${quotedBase}/${name} ]; then basename "$(readlink ${quotedBase}/${name})"; else printf '\\n'; fi`;

/** The shell that lists the stored releases under `quotedBase`/releases, newest first; no releases directory prints nothing and succeeds, a failing `ls` fails the script. */
export const releaseListScript = (quotedBase: string): string => `if [ -d ${quotedBase}/releases ]; then ls -1t ${quotedBase}/releases; fi`;

/** Runs `docker <args>` on the manager through `run` (every argument quoted). */
export const remoteDocker = (run: (command: string) => RemoteResult, args: string[]): RemoteResult => run(['docker', ...args.map(shellQuote)].join(' '));

const noop = () => {};

interface RunnerOptions { cleanup?: (() => unknown) | undefined; notes?: string[] | undefined; connection?: SshConnection | undefined }

function makeRunner(ctx: StackContext, argv: Argv, { cleanup = noop, notes = [], connection }: RunnerOptions = {}): Runner {
  const [command, ...head] = argv;
  const run = (remote: string, { input }: { input?: string | undefined } = {}): RemoteResult => {
    const options = input === undefined ? {} : { input: lfOnly(input) };
    const result: RunResult = connection ? connection.remote(lfOnly(remote), options) : tool(ctx, command, [...head, lfOnly(remote)], options);
    if (result.error) return { status: 127, stdout: '', stderr: `cannot run ${command}: ${result.error.message}` };
    return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
  };
  const argvOf = (remote: string): RemoteArgv => (connection ? connection.remoteArgv(lfOnly(remote)) : { command, args: [...head, lfOnly(remote)], env: ctx.env });
  return Object.assign(run, { cleanup, notes, argv: argvOf });
}

function sshCommandArgv(sshCmd: unknown): Argv {
  const parts = String(sshCmd).split(/\s+/u).filter(Boolean);
  const [first, ...rest] = parts;
  if (first === undefined) throw refusal('STACK_REMOTE_SSH_CMD', '--ssh-cmd is empty');
  return [first, ...rest];
}

/**
 * The key each sealed SSH member of `deploy.remote.sealed` holds (contexts/project/stacks.md PROJECT-STACKS-5): the one owner of
 * these names. `sshKey` names the member whose `privateKey` is the PEM private key, `knownHosts` the member whose `knownHosts` is
 * the pinned known_hosts text.
 */
export const SEALED_SSH_KEYS = Object.freeze({ sshKey: 'privateKey', knownHosts: 'knownHosts' });

/** A legacy binary member is the file itself; a JSON object around it ({ data | <key> }, the re-sealed shape of `starci app secret rename`) is unwrapped. */
function unwrap(text: string, key: string): string {
  const body = lfOnly(text);
  const trimmed = body.trim();
  if (!trimmed.startsWith('{')) return body;
  // reason: the envelope is JSON parsed from a sealed member; only string fields are read
  let parsed: any;
  try { parsed = JSON.parse(trimmed); } catch { return body; }
  for (const name of ['data', key]) if (typeof parsed[name] === 'string') return lfOnly(parsed[name]);
  return body;
}

/** The sops format a sealed member is read as: a `.enc.yaml` member is YAML, a legacy `.enc` one dotenv. */
const memberFormat = (file: string): string => (isLegacyName(file) ? 'dotenv' : 'yaml');

/** Opens one member through the sops seam; a failure is refused naming the member and the seam's own reason (format, recipients, identity). */
function openMember<T>(slug: string, read: () => T): T {
  try { return read(); } catch (error) { throw refusal('STACK_REMOTE_SEALED', `cannot open the sealed member ${slug}: ${(error as Error).message}`); }
}

function opsAccount(ctx: StackContext, config: DeployConfig, sealed: SealedRemote): string {
  const slug = sealed.ops;
  const file = memberFile(config.secretsDir, slug);
  const map = openMember(slug, () => ctx.sops.decrypt(file, memberFormat(file)));
  for (const name of ['VPS_HOST', 'VPS_USER']) {
    const value = map[name];
    if (typeof value !== 'string' || !ACCOUNT.test(value) || value.startsWith('-')) throw refusal('STACK_REMOTE_OPS', `${slug} must hold ${name} (letters, digits, . _ @ -)`);
  }
  return `${map.VPS_USER}@${map.VPS_HOST}`;
}

/**
 * The text a sealed SSH member holds under `key` (SEALED_SSH_KEYS): a `.enc.yaml` member is read as YAML and the key taken from
 * its map; a legacy `.enc` member is the sops binary or JSON envelope it was sealed as.
 */
function sshMember(ctx: StackContext, config: DeployConfig, slug: string, key: string): string {
  const file = memberFile(config.secretsDir, slug);
  if (isLegacyName(file)) return unwrap(openMember(slug, () => ctx.sops.decryptBinary(file)), key);
  const map = openMember(slug, () => ctx.sops.decrypt(file, 'yaml'));
  const held = map[key];
  if (typeof held !== 'string' || held === '')
    throw refusal('STACK_REMOTE_SEALED', `the sealed member ${slug} holds no ${key} (it holds ${Object.keys(map).join(', ') || 'no key'}): seal it with starci app secret set --env ${config.env ?? '<env>'} ${slug} ${key} --from-file ${key}=<file>`);
  return lfOnly(held);
}

const withNewline = (text: string): string => `${text.trim()}\n`;

/** CI (a Linux runner): the file with exactly this mode. */
function writeWithMode(file: string, text: string, mode: number): void {
  fs.writeFileSync(file, text, { mode });
  fs.chmodSync(file, mode);
}

/** The files and facts of one owner-machine session. */
export interface SealedSession {
  account: string;
  dir: string;
  keyFile: string;
  knownFile: string;
  strict: string;
  notes: string[];
  cleanup: () => void;
  port?: number;
}

/** The owner-machine session files: key and known_hosts in a private temp directory, removed (key overwritten) by cleanup(). */
export function openSealedSession(ctx: StackContext, config: DeployConfig): SealedSession {
  const { sealed } = config.remote;
  if (!sealed) throw refusal('STACK_REMOTE_SEALED', 'deploy.remote.sealed is not declared');
  const account = opsAccount(ctx, config, sealed);
  if (config.nativeTarget && account !== `${config.nativeTarget.user}@${config.nativeTarget.host}`)
    throw refusal('STACK_REMOTE_OPS', 'the sealed SSH account differs from the accepted native target');
  const key = sshMember(ctx, config, sealed.sshKey, SEALED_SSH_KEYS.sshKey);
  if (!key.includes('PRIVATE KEY')) throw refusal('STACK_REMOTE_KEY', `${sealed.sshKey} does not hold a PEM private key`);
  const known = sshMember(ctx, config, sealed.knownHosts, SEALED_SSH_KEYS.knownHosts).trim();
  assertStackAccount(config.nativeTarget, account, known);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stack-ssh-'));
  const keyFile = path.join(dir, 'id');
  const knownFile = path.join(dir, 'known_hosts');
  const cleanup = () => {
    if (fs.existsSync(keyFile)) {
      restrictToUser(ctx, keyFile, 'F');
      fs.writeFileSync(keyFile, '0'.repeat(key.length));
    }
    fs.rmSync(dir, { recursive: true, force: true });
  };
  try {
    writePrivate(ctx, keyFile, withNewline(key));
    writePrivate(ctx, knownFile, known ? withNewline(known) : '');
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  const notes = known ? [] : ['owner-machine session without known_hosts: the host key is accepted on first contact (accept-new); verify it, CI never does this'];
  return { account, dir, keyFile, knownFile, strict: known ? 'yes' : 'accept-new', notes, cleanup,
    ...(config.nativeTarget ? { port: config.nativeTarget.port } : {}) };
}

/** The owner-machine runner over that session. */
function sealedRunner(ctx: StackContext, config: DeployConfig): Runner {
  const session = openSealedSession(ctx, config);
  const argv: Argv = ['ssh', '-T', ...(session.port ? ['-p', String(session.port)] : []), '-i', session.keyFile, '-o', 'IdentitiesOnly=yes', '-o', `UserKnownHostsFile=${session.knownFile}`, '-o', `StrictHostKeyChecking=${session.strict}`, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', session.account];
  return sessionRunner(ctx, argv, session.dir, session.cleanup, session.notes);
}

function sessionRunner(ctx: StackContext, argv: Argv, dir: string, cleanup: () => void, notes: string[] = []): Runner {
  const connection = createSshSession(ctx, { argv, controlPath: path.join(dir, 'cm').replaceAll('\\', '/'), cleanup });
  return makeRunner(ctx, argv, { connection, cleanup: connection.close, notes });
}

/** The ssh runner of one invocation (see the top of the file). */
function sshRunner(ctx: StackContext, config: DeployConfig, { sshCmd = null }: SshOptions = {}): Runner {
  if (ctx.stackSsh && !sshCmd) return makeRunner(ctx, ['ssh'], { connection: ctx.stackSsh });
  if (sshCmd) return makeRunner(ctx, sshCommandArgv(sshCmd));
  if (config.remote.sealed && ctx.env.STARCI_STACK_SEALED_SSH === '1') return sealedRunner(ctx, config);
  const dir = sessionDirectory();
  return sessionRunner(ctx, ['ssh', ...SSH_OPTIONS, config.remote.host], dir, () => fs.rmSync(dir, { recursive: true, force: true }));
}

/**
 * The context to open the runner with. On an operator machine (not CI, no --ssh-cmd, the sealed members exist, no explicit
 * STARCI_STACK_SEALED_SSH) the sealed session is selected; otherwise the context is returned unchanged.
 */
function withOwnerTransport(ctx: StackContext, config: DeployConfig, { sshCmd = null }: SshOptions = {}): StackContext {
  const { sealed } = config.remote;
  if (config.nativeTarget) return Object.create(ctx, { env: { value: { ...ctx.env, STARCI_STACK_SEALED_SSH: '1' }, enumerable: true } });
  if (sshCmd || !sealed || ctx.env.GITHUB_ACTIONS === 'true' || ctx.env.STARCI_STACK_SEALED_SSH !== undefined) return ctx;
  const present = [sealed.ops, sealed.sshKey, sealed.knownHosts].every((slug) => fs.existsSync(memberFile(config.secretsDir, slug)));
  if (!present) return ctx;
  return Object.create(ctx, { env: { value: { ...ctx.env, STARCI_STACK_SEALED_SSH: '1' }, enumerable: true } });
}

/** The runner of a verb that opens it itself (deploy, rollback, accept): the owner-machine session is selected exactly as `withRunner` does. */
export const ownerSshRunner = (ctx: StackContext, config: DeployConfig, options: SshOptions = {}): Runner => sshRunner(withOwnerTransport(ctx, config, options), config, options);

/** Opens the runner (`deps.ssh` wins in specs), calls `body(run, notes)` and always cleans the session up. */
export async function withRunner<T>(ctx: StackContext, config: DeployConfig, options: SshOptions, deps: RunnerDeps, body: (run: Runner, notes: string[]) => T | Promise<T>): Promise<T> {
  const run = deps.ssh ?? sshRunner(withOwnerTransport(ctx, config, options), config, options);
  try {
    return await body(run, run.notes ?? []);
  } finally {
    await run.cleanup?.();
  }
}

function ciHome(ctx: StackContext): string {
  if (ctx.env.GITHUB_ACTIONS !== 'true') throw refusal('STACK_CONNECT_CI_ONLY', 'connect and disconnect run only in GitHub Actions (GITHUB_ACTIONS=true)');
  if (!ctx.env.HOME) throw refusal('STACK_CONNECT_NO_HOME', 'HOME is not set');
  return path.join(ctx.env.HOME, '.ssh');
}

interface CiInputs { key: string; known: string; host: string; user: string }

/** The sealed member that holds the CI transport of an environment: VPS_SSH_KEY (the CI-only deploy key), VPS_KNOWN_HOSTS, VPS_HOST and VPS_USER. */
export const CI_MEMBER = 'vps-ci';

/**
 * The CI transport values: the sealed member `vps-ci` of the environment (opened with the server identity the job holds) when it exists, else the
 * variables of the job (the transition, and the owner's own runs). The member keeps the host, the account, the key and the pinned host keys out of
 * GitHub and of a public log; the pinned host keys are reviewed in git as ciphertext.
 */
function ciValues(ctx: StackContext, config: DeployConfig): { values: Record<string, string | undefined>; sealed: boolean } {
  const present = typeof config.secretsDir === 'string' && fs.existsSync(memberFile(config.secretsDir, CI_MEMBER));
  if (!present) return { values: ctx.env, sealed: false };
  const map = openSealedMember(ctx, config, CI_MEMBER);
  return { values: Object.fromEntries([...CI_VARIABLES, 'VPS_GATE'].map((name) => [name, typeof map[name] === 'string' ? map[name] : undefined])), sealed: true };
}

function ciInputs(ctx: StackContext, values: Record<string, string | undefined>, sealed: boolean): CiInputs {
  for (const name of CI_VARIABLES) if (!values[name]) throw refusal('STACK_CONNECT_MISSING', sealed ? `the sealed member ${CI_MEMBER} holds no ${name}` : `${name} is not set and the environment has no sealed member ${CI_MEMBER}`);
  const [host, user] = ['VPS_HOST', 'VPS_USER'].map((name) => {
    const value = values[name] as string; // set: every CI variable was checked above
    if (!ACCOUNT.test(value) || value.startsWith('-')) throw refusal('STACK_CONNECT_INVALID', `${name} must match ${ACCOUNT}`);
    return value;
  }) as [string, string];
  const key = lfOnly(values.VPS_SSH_KEY);
  if (!key.includes('PRIVATE KEY')) throw refusal('STACK_CONNECT_INVALID', 'VPS_SSH_KEY is not a PEM private key');
  if (!ctx.env.GITHUB_ENV) throw refusal('STACK_CONNECT_NO_GITHUB_ENV', 'GITHUB_ENV is not set');
  return { key: withNewline(key), known: withNewline(lfOnly(values.VPS_KNOWN_HOSTS)), host, user };
}

const sshBlock = (alias: string, inputs: CiInputs): string => [
  '', `Host ${alias}`, `  HostName ${inputs.host}`, `  User ${inputs.user}`, '  IdentityFile ~/.ssh/deploy_key',
  '  StrictHostKeyChecking yes', '  BatchMode yes', '  ConnectTimeout 20', '  ServerAliveInterval 30',
  '  ControlMaster auto', '  ControlPath ~/.ssh/cm-%C', '  ControlPersist 60', '',
].join('\n');

/** CI transport: pinned key, known_hosts, ssh config block and DOCKER_HOST=ssh://<alias> in $GITHUB_ENV. */
export async function connectCi(ctx: StackContext, config: DeployConfig, { execute = false }: { execute?: boolean } = {}): Promise<ActionResult> {
  const dir = ciHome(ctx);
  const { values, sealed } = ciValues(ctx, config);
  const inputs = ciInputs(ctx, values, sealed);
  const alias = config.remote.host;
  const gated = values.VPS_GATE === '1';
  const origin = sealed ? `the sealed member ${CI_MEMBER}` : 'VPS_SSH_KEY';
  const plan = [...(gated ? ['STARCI_SSH_GATE=1 in GITHUB_ENV (the key is forced through starci-ssh-gate)'] : []), `${dir}/deploy_key (0600) from ${origin}`, `${dir}/known_hosts (0644) from ${sealed ? CI_MEMBER : 'VPS_KNOWN_HOSTS'}`, `a Host ${alias} block in ${dir}/config`, `DOCKER_HOST=ssh://${alias} in GITHUB_ENV`];
  const data = { host: alias, files: ['deploy_key', 'known_hosts', 'config'], sealed, gated };
  if (!execute) return { ok: true, lines: plan.map((item) => `dry run: would write ${item}`), data };
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeWithMode(path.join(dir, 'deploy_key'), inputs.key, 0o600);
  writeWithMode(path.join(dir, 'known_hosts'), inputs.known, 0o644);
  fs.appendFileSync(path.join(dir, 'config'), sshBlock(alias, inputs), { mode: 0o600 });
  fs.appendFileSync(ctx.env.GITHUB_ENV as string,`DOCKER_HOST=ssh://${alias}
${gated ? 'STARCI_SSH_GATE=1' + String.fromCharCode(10) : ''}`);
  // The log of a public repository is public: mask the host, the account and the releases root before any later line can carry them.
  const masks = sealed ? [inputs.host, inputs.user, config.remote.releasesBase].filter((value): value is string => typeof value === 'string' && value.length >= 4).map((value) => `::add-mask::${value}`) : [];
  return { ok: true, lines: [...masks, ...plan.map((item) => `wrote ${item}`)], data };
}

/** CI cleanup: closes the ssh control master (failure ignored) and removes the deploy key. */
export async function disconnectCi(ctx: StackContext, config: DeployConfig, { execute = false }: { execute?: boolean } = {}): Promise<ActionResult> {
  const dir = ciHome(ctx);
  const alias = config.remote.host;
  const data = { host: alias };
  if (!execute) return { ok: true, lines: [`dry run: would run ssh -O exit ${alias} and remove ${dir}/deploy_key`], data };
  tool(ctx, 'ssh', ['-O', 'exit', alias]);
  fs.rmSync(path.join(dir, 'deploy_key'), { force: true });
  return { ok: true, lines: [`closed the ssh session to ${alias} and removed ${dir}/deploy_key`], data };
}
