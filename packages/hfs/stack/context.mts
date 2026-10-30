// context.mjs - the seams every stack module runs through: spawning tools, sleeping, the clock and the output.
// Production uses the real implementations; a spec injects fakes.
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess, SpawnOptions as NodeSpawnOptions } from 'node:child_process';
import type { SshConnection } from './ssh-session.mjs';
import { defaultSops } from '../runtime/scripts/hfs/secret-sops.mjs';
import type { AgeHost } from '../runtime/scripts/hfs/secret-init.mjs';

const MAX_BUFFER = 1 << 24;

/** The result of one tool run. */
export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: NodeJS.ErrnoException | undefined;
}

/** The options of one tool run: `input` is written to stdin, `env` replaces the child environment, `background` returns the child. */
export interface SpawnOptions {
  input?: string | Buffer | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  cwd?: string | undefined;
  background?: boolean | undefined;
  timeout?: number | undefined;
  [option: string]: unknown;
}

/** A background child; an asynchronous spawn failure is kept on `spawnError`. */
export type BackgroundChild = ChildProcess & { spawnError?: Error };

/** The spawn seam: never a shell; `{ background: true }` returns the owned child. */
export interface Spawn {
  (command: string, args: readonly string[], options: SpawnOptions & { background: true }): BackgroundChild;
  (command: string, args: readonly string[], options?: SpawnOptions): RunResult;
}

/** The progress sink of a verb that checks or changes the host: successes, failures and neutral notes. */
export interface Report {
  ok(text: string): void;
  bad(text: string): void;
  note(text: string): void;
}

/** One end of a pipe: the process whose stdout is streamed, or the one that receives it on stdin. */
export interface PipeEnd {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv | undefined;
  cwd?: string | undefined;
}

/** Exit codes of both ends of a pipe and the first stderr line of a failure. */
export interface PipeResult {
  source: number;
  sink: number;
  stderr: string;
}

/** The secret seam: decrypts the app's sops files. */
export interface Sops {
  decrypt(file: string, format?: string): Record<string, string>;
  decryptBinary(file: string): string;
  /** Wraps one sealed member again to its rule (server-key); the owner identity opens the data key only. */
  updateKeys(file: string): void;
  /** Refuses up front when the owner identity is unreachable (optional: a spec double has none). */
  requireIdentity?(file: string): void;
  /** Where the age identity was found; a seam without it (a spec double) decides for itself. */
  identity?: { source: string | null; looked: string[] } | undefined;
}

const realSpawn: Spawn = ((command: string, args: readonly string[], options: SpawnOptions = {}) => {
  if (options.background) {
    const childOptions: SpawnOptions = { ...options };
    delete childOptions.background;
    const child: BackgroundChild = spawn(command, args, { stdio: 'ignore', windowsHide: true, ...(childOptions as NodeSpawnOptions) });
    child.on('error', (error) => { child.spawnError = error; });
    return child;
  }
  const run = spawnSync(command, args, { encoding: 'utf8', maxBuffer: MAX_BUFFER, ...(options as NodeSpawnOptions) });
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '', error: run.error };
}) as Spawn;

/** Bytes of a stream's stderr a pipe keeps, for the first line of a failure. */
const STDERR_KEPT = 4096;

/**
 * Streams `source`'s stdout into `sink`'s stdin, neither through a shell, and resolves { source, sink, stderr } (exit codes and
 * the first stderr line of a failure). The bytes pass through the OS pipe only: they are never collected, logged or written to disk.
 */
const realPipe = (source: PipeEnd, sink: PipeEnd): Promise<PipeResult> => new Promise((resolve) => {
  const options = (end: PipeEnd, stdio: ['ignore' | 'pipe', 'ignore' | 'pipe', 'pipe']): NodeSpawnOptions => ({ env: end.env, cwd: end.cwd, stdio, windowsHide: true });
  const from = spawn(source.command, source.args, options(source, ['ignore', 'pipe', 'pipe']));
  const to = spawn(sink.command, sink.args, options(sink, ['pipe', 'ignore', 'pipe']));
  const codes: Partial<Record<'source' | 'sink', number>> = {};
  let stderr = '';
  const keep = (chunk: unknown): void => { if (stderr.length < STDERR_KEPT) stderr += String(chunk).slice(0, STDERR_KEPT - stderr.length); };
  from.stderr?.on('data', keep);
  to.stderr?.on('data', keep);
  to.stdin?.on('error', () => {});
  if (from.stdout && to.stdin) from.stdout.pipe(to.stdin);
  const settle = (name: 'source' | 'sink') => (code: number | null): void => {
    codes[name] = code ?? 1;
    if (codes.source !== undefined && codes.sink !== undefined) resolve({ source: codes.source, sink: codes.sink, stderr: stderr.trim().split(/\r?\n/u)[0] ?? '' });
  };
  from.on('error', () => { if (from.stdout && to.stdin) from.stdout.unpipe(to.stdin); to.stdin?.end(); settle('source')(127); });
  to.on('error', () => settle('sink')(127));
  from.on('close', settle('source'));
  to.on('close', settle('sink'));
});

const realSleep = (ms: number): Promise<void> => new Promise((done) => { setTimeout(done, ms); });

/** What a caller (or a spec) may inject into stackContext; every seam is optional and defaults to the real one. */
export interface StackIo {
  cwd?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  spawn?: Spawn | undefined;
  platform?: NodeJS.Platform | undefined;
  username?: string | undefined;
  sshPath?: string | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  now?: (() => number) | undefined;
  stdout?: ((text: string) => void) | undefined;
  stderr?: ((text: string) => void) | undefined;
  fetch?: typeof fetch | undefined;
  pipe?: ((source: PipeEnd, sink: PipeEnd) => Promise<PipeResult>) | undefined;
  sops?: Sops | undefined;
  openSops?: (() => Sops) | undefined;
  hostIdentity?: AgeHost | null | undefined;
  harness?: { role?: string | undefined } | undefined;
  importer?: ((file: string) => Promise<Record<string, unknown>>) | undefined;
}

/** The context of one stack invocation (see stackContext). */
export interface StackContext {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly spawn: Spawn;
  readonly platform: NodeJS.Platform;
  readonly username: string | undefined;
  readonly sshPath: string | undefined;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly fetch: typeof fetch;
  readonly pipe: (source: PipeEnd, sink: PipeEnd) => Promise<PipeResult>;
  readonly sops: Sops;
  /** The command-owned SSH connection, set by the Docker transport (docker-transport.mjs). */
  readonly stackSsh?: SshConnection | undefined;
}

/**
 * The context of one stack invocation.
 *   cwd, env       the app root and the process environment
 *   spawn          (command, args, { input, env, cwd }) -> { status, stdout, stderr, error }; never a shell
 *                  { background: true } -> ChildProcess, owned and killed by the command session
 *   platform       POSIX control master or win32 loopback tunnel; sshPath optionally selects the POSIX SSH executable
 *   sleep, now     await sleep(ms); now() -> epoch ms
 *   stdout, stderr text writers
 *   fetch          the HTTP seam of verify (url, init) -> Response
 *   pipe           (source, sink) -> Promise<{ source, sink, stderr }>: one process's stdout streamed into another's stdin (realPipe)
 *   sops           the secret seam (decrypt(file, format) -> map; decryptBinary(file) -> text); `io.sops`, else on first use `io.openSops()` or the app's own sops/age tools with the age identity decryptionIdentity finds (`io.hostIdentity` the harness CLI's secret.env)
 */
export function stackContext(io: StackIo = {}): StackContext {
  const cwd = io.cwd ?? process.cwd();
  const env = io.env ?? process.env;
  let sops = io.sops;
  return Object.freeze({
    cwd,
    env,
    spawn: io.spawn ?? realSpawn,
    platform: io.platform ?? process.platform,
    username: io.username,
    sshPath: io.sshPath,
    sleep: io.sleep ?? realSleep,
    now: io.now ?? Date.now,
    stdout: io.stdout ?? ((text: string) => process.stdout.write(text)),
    stderr: io.stderr ?? ((text: string) => process.stderr.write(text)),
    fetch: io.fetch ?? globalThis.fetch,
    pipe: io.pipe ?? realPipe,
    /** The secret seam: the app's own sops/age tools, created on first use so verbs that open no custody never need them. */
    get sops(): Sops {
      const opened: Sops = sops ?? io.openSops?.() ?? defaultSops(env, cwd, io.platform ?? process.platform, undefined, io.hostIdentity ?? null);
      sops = opened;
      return opened;
    },
  });
}

/** Runs one tool; `env` replaces the child environment when given, `input` is written to its stdin. */
export const tool = (ctx: Pick<StackContext, 'spawn'>, command: string, args: readonly string[], options: SpawnOptions = {}): RunResult => ctx.spawn(command, args, options);

/** Runs a tool and returns stdout, or throws the first stderr line. Used where a failure has no recovery. */
export function toolOutput(ctx: Pick<StackContext, 'spawn'>, command: string, args: readonly string[], options: SpawnOptions = {}): string {
  const run = tool(ctx, command, args, options);
  if (run.error) throw new Error(`cannot run ${command} (${run.error.message})`);
  if (run.status !== 0) throw new Error(`${command} ${args.slice(0, 2).join(' ')}: ${firstLine(run.stderr)}`);
  return run.stdout;
}

export const firstLine = (text: unknown): string => String(text ?? '').trim().split(/\r?\n/u)[0] ?? '';
export const lines = (text: unknown): string[] => String(text ?? '').split(/\r?\n/u).filter(Boolean);
