// local-host.mjs - the host prerequisites of a dev environment, one row each: what is needed, whether this machine has it, and the exact
// install step the owner runs when it does not (winget on Windows, brew on macOS, apt on Linux). Read-only: it probes tools through the spawn
// seam, reads sizes and the app's declared ports, and installs nothing (rules.md rules 5 and 8; the owner runs the printed steps).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { firstLine } from './context.mjs';
import type { RunResult, StackContext } from './context.mjs';
import type { LocalBlock } from '../runtime/scripts/hfs/stack-local-config.mjs';
import { bindFree, holderOf } from './local-ports.mjs';
import { readRecord } from './local-state.mjs';

/** One row of the prerequisite table. */
export interface Prerequisite { id: string; ok: boolean; detail: string; fix: string | null }

/** The seams of the host probes a spec replaces. */
export interface HostDeps {
  portFree?: ((port: number) => Promise<boolean>) | undefined;
  diskFreeGb?: ((dir: string) => number | null) | undefined;
  memoryMb?: (() => { free: number; total: number }) | undefined;
}

type Platform = 'win32' | 'darwin' | 'linux';
const INSTALL: Record<string, Record<Platform, string>> = {
  node: { win32: 'winget install OpenJS.NodeJS.LTS', darwin: 'brew install node', linux: 'sudo apt install nodejs npm, or nvm install <version>' },
  npm: { win32: 'winget install OpenJS.NodeJS.LTS (npm ships with Node)', darwin: 'brew install node (npm ships with Node)', linux: 'sudo apt install npm' },
  git: { win32: 'winget install Git.Git', darwin: 'brew install git', linux: 'sudo apt install git' },
  docker: { win32: 'winget install Docker.DockerDesktop, then start Docker Desktop and wait for the engine', darwin: 'brew install --cask docker, then open Docker', linux: 'sudo apt install docker.io, then sudo systemctl enable --now docker and add your user to the docker group' },
  compose: { win32: 'update Docker Desktop (it ships Compose v2): winget upgrade Docker.DockerDesktop', darwin: 'brew upgrade --cask docker', linux: 'sudo apt install docker-compose-v2' },
  wsl: { win32: 'wsl --install (an administrator terminal), then restart', darwin: 'not needed', linux: 'not needed' },
  sops: { win32: 'winget install Mozilla.SOPS', darwin: 'brew install sops', linux: 'download the sops release for your CPU from https://github.com/getsops/sops/releases and put it on PATH' },
  age: { win32: 'winget install FiloSottile.age', darwin: 'brew install age', linux: 'sudo apt install age' },
};

const platformOf = (ctx: Pick<StackContext, 'platform'>): Platform => (ctx.platform === 'win32' || ctx.platform === 'darwin' ? ctx.platform : 'linux');
const NPM_SHIMS = new Set(['npm', 'npx']);

/**
 * How to start `command` on this platform without a shell. npm and npx are `.cmd` shims on Windows, which cannot be spawned directly: they run as
 * `node <npm-cli.js>` from the Node install beside this node when it is there, else through `cmd.exe /d /s /c`.
 */
export function launch(platform: NodeJS.Platform, command: string, args: readonly string[], exists: (file: string) => boolean = fs.existsSync): [string, string[]] {
  if (platform !== 'win32' || !NPM_SHIMS.has(command)) return [command, [...args]];
  const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', `${command}-cli.js`);
  return exists(cli) ? [process.execPath, [cli, ...args]] : ['cmd.exe', ['/d', '/s', '/c', command, ...args]];
}

/** Runs a host tool without a shell (see launch). */
export function hostTool(ctx: Pick<StackContext, 'spawn' | 'platform'>, command: string, args: readonly string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): RunResult {
  const [file, argv] = launch(ctx.platform, command, args);
  return ctx.spawn(file, argv, options);
}

const present = (run: RunResult): boolean => run.error === undefined && run.status === 0;
const versionOf = (text: string): string | null => /(\d+)\.(\d+)(?:\.(\d+))?/u.exec(text)?.[0] ?? null;
const wantedOf = (text: string): string | null => /\d+(?:\.\d+){0,2}/u.exec(text)?.[0] ?? null;
const atLeast = (have: string, need: string): boolean => {
  const [a = 0, b = 0, c = 0] = have.split('.').map(Number);
  const [x = 0, y = 0, z = 0] = need.split('.').map(Number);
  if (a !== x) return a > x;
  return b !== y ? b > y : c >= z;
};

/** The Node version the app asks for: `.nvmrc`, else the first version of `engines.node`; null when it asks for none. */
export function wantedNode(repoRoot: string): string | null {
  try { return wantedOf(fs.readFileSync(path.join(repoRoot, '.nvmrc'), 'utf8')); } catch { /* no .nvmrc */ }
  try { return wantedOf(String((JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { engines?: { node?: string } }).engines?.node ?? '')); } catch { return null; }
}

const diskFree = (dir: string): number | null => {
  let at = dir;
  while (!fs.existsSync(at) && path.dirname(at) !== at) at = path.dirname(at);
  try { const stat = fs.statfsSync(at); return Math.floor((stat.bavail * stat.bsize) / 1024 ** 3); } catch { return null; }
};

function tool(ctx: StackContext, id: string, row: { command: string; args: string[]; label: string }): Prerequisite {
  const run = hostTool(ctx, row.command, row.args);
  if (!present(run)) return { id, ok: false, detail: `${row.label} not found on PATH`, fix: INSTALL[id]?.[platformOf(ctx)] ?? null };
  return { id, ok: true, detail: `${row.label} ${versionOf(`${run.stdout} ${run.stderr}`) ?? firstLine(run.stdout)}`, fix: null };
}

function docker(ctx: StackContext): Prerequisite[] {
  const platform = platformOf(ctx);
  const cli = hostTool(ctx, 'docker', ['--version']);
  if (!present(cli)) return [{ id: 'docker', ok: false, detail: 'docker not found on PATH', fix: INSTALL.docker?.[platform] ?? null }, { id: 'compose', ok: false, detail: 'needs docker first', fix: INSTALL.compose?.[platform] ?? null }];
  const info = ctx.spawn('docker', ['info', '--format', '{{.ServerVersion}} {{.OSType}}']);
  const [server, kind] = firstLine(info.stdout).split(' ');
  const rows: Prerequisite[] = [];
  if (!present(info) || !server) rows.push({ id: 'docker', ok: false, detail: 'the docker engine does not answer', fix: platform === 'linux' ? 'sudo systemctl start docker' : 'start Docker Desktop and wait until it reports the engine running' });
  else if (kind !== 'linux') rows.push({ id: 'docker', ok: false, detail: `docker serves ${kind} containers`, fix: 'switch Docker Desktop to Linux containers' });
  else rows.push({ id: 'docker', ok: true, detail: `docker engine ${server} (linux containers)`, fix: null });
  const compose = ctx.spawn('docker', ['compose', 'version', '--short']);
  const have = versionOf(compose.stdout);
  if (!present(compose) || !have) rows.push({ id: 'compose', ok: false, detail: 'docker compose v2 not found', fix: INSTALL.compose?.[platform] ?? null });
  else if (!atLeast(have, '2.20')) rows.push({ id: 'compose', ok: false, detail: `docker compose ${have} found, 2.20 or newer wanted`, fix: INSTALL.compose?.[platform] ?? null });
  else rows.push({ id: 'compose', ok: true, detail: `docker compose ${have}`, fix: null });
  return rows;
}

/** True when the environment's secrets folder holds a sealed member. */
export const hasSealedMembers = (secretsDir: string): boolean => {
  try { return fs.readdirSync(secretsDir).some((name) => /\.enc(\.yaml)?$/u.test(name)); } catch { return false; }
};

/** One row per declared port: free, or held by this environment's own record, or held by someone else (named). */
export async function portRows(ctx: StackContext, local: LocalBlock, stateDir: string, deps: HostDeps = {}): Promise<Prerequisite[]> {
  const free = deps.portFree ?? bindFree;
  const own = new Set(Object.values(readRecord(stateDir).ports));
  const rows: Prerequisite[] = [];
  for (const [name, port] of Object.entries(local.ports)) {
    if (await free(port)) rows.push({ id: `port ${name}`, ok: true, detail: `${port} is free`, fix: null });
    else if (own.has(port)) rows.push({ id: `port ${name}`, ok: true, detail: `${port} is held by this environment`, fix: null });
    else if (holderOf(ctx, port).startsWith(`container ${local.project}-`)) rows.push({ id: `port ${name}`, ok: true, detail: `${port} is held by this environment's container`, fix: null });
    else rows.push({ id: `port ${name}`, ok: false, detail: `${port} is held by ${holderOf(ctx, port)}`, fix: `stop that holder, or change ports.${name} in .starcistacks/application-stacks.yaml` });
  }
  return rows;
}

function nodeRow(ctx: StackContext, repoRoot: string): Prerequisite {
  const want = wantedNode(repoRoot);
  const node = ctx.spawn('node', ['--version']);
  const have = versionOf(node.stdout);
  if (present(node) && have && (!want || atLeast(have, want))) return { id: 'node', ok: true, detail: `node ${have}${want ? ` (the app wants ${want} or newer)` : ''}`, fix: null };
  return { id: 'node', ok: false, detail: present(node) ? `node ${have} found, ${want} or newer wanted by .nvmrc or engines.node` : 'node not found on PATH', fix: INSTALL.node?.[platformOf(ctx)] ?? null };
}

function resourceRows(local: LocalBlock, stateDir: string, deps: HostDeps): Prerequisite[] {
  const disk = (deps.diskFreeGb ?? diskFree)(stateDir);
  const memory = (deps.memoryMb ?? (() => ({ free: Math.floor(os.freemem() / 1024 ** 2), total: Math.floor(os.totalmem() / 1024 ** 2) })))();
  return [
    disk === null || disk >= local.resources.diskGb
      ? { id: 'disk', ok: true, detail: disk === null ? 'free disk not readable here' : `${disk} GB free (${local.resources.diskGb} GB wanted)`, fix: null }
      : { id: 'disk', ok: false, detail: `${disk} GB free, ${local.resources.diskGb} GB wanted`, fix: 'free disk space, or prune unused images with docker image prune (an owner step)' },
    memory.total >= local.resources.ramMb
      ? { id: 'memory', ok: true, detail: `${memory.total} MB RAM (${memory.free} MB free, ${local.resources.ramMb} MB wanted)`, fix: null }
      : { id: 'memory', ok: false, detail: `${memory.total} MB RAM, ${local.resources.ramMb} MB wanted`, fix: 'close other work or use a machine with more memory' },
  ];
}

/** The whole table for one environment: tools, engine, resources, then the declared ports. */
export async function hostPrerequisites(ctx: StackContext, local: LocalBlock, where: { repoRoot: string; stateDir: string; secretsDir: string }, deps: HostDeps = {}): Promise<Prerequisite[]> {
  const rows: Prerequisite[] = [nodeRow(ctx, where.repoRoot), tool(ctx, 'npm', { command: 'npm', args: ['--version'], label: 'npm' }), tool(ctx, 'git', { command: 'git', args: ['--version'], label: 'git' }), ...docker(ctx)];
  if (ctx.platform === 'win32') {
    const wsl = ctx.spawn('wsl.exe', ['--status']);
    rows.push(present(wsl) ? { id: 'wsl', ok: true, detail: 'WSL2 is installed', fix: null } : { id: 'wsl', ok: false, detail: 'WSL2 is not available (Docker Desktop runs Linux containers on it)', fix: INSTALL.wsl?.win32 ?? null });
  }
  if (hasSealedMembers(where.secretsDir)) rows.push(tool(ctx, 'sops', { command: 'sops', args: ['--version'], label: 'sops' }), tool(ctx, 'age', { command: 'age', args: ['--version'], label: 'age' }));
  rows.push(...resourceRows(local, where.stateDir, deps), ...await portRows(ctx, local, where.stateDir, deps));
  return rows;
}

/** The table as printed lines: `ok    ` and `FAIL  ` rows, each failure followed by its owner-run step. */
export function tableLines(rows: readonly Prerequisite[]): string[] {
  return rows.flatMap((row) => [`${row.ok ? 'ok    ' : 'FAIL  '}${row.id}: ${row.detail}`, ...(row.ok || !row.fix ? [] : [`      owner step: ${row.fix}`])]);
}
