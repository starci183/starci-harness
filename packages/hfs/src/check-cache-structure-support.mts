// check-cache-structure-support.mts - the fixture the structure-cache specs (check-cache-structure*.spec.mts) share: a small two-sided app in a real
// temp git repository (the pass reads git, the work tree and the cache folder), and a run of the structure pass against a disk session over it.
import fs from 'node:fs';
import module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { git } from '../cache/git.mjs';
import { silentProgress } from '../cache/progress.mjs';
import { createDiskSession } from '../cache/session.mjs';
import { HFS_FOLDER, runStructurePass, SECRETS_FOLDER, type PassResult } from '../cache/hfs-family.mjs';
import type { CacheRecord } from '../cache/types.mjs';
import type { MachineFn } from '../runtime/scripts/hfs/check.mjs';
import { trackedFiles } from '../runtime/scripts/hfs/check.mjs';
import { bundledPresets } from '../sync/index.mjs';

export const PORTABLE = { parts: [{ name: 'hfs', sha256: 'h1' }], portable: true, localReasons: [] };

/** An AWS access key shape the secret scan refuses (built from parts: the fixture is data, not a credential). */
export const FAKE_KEY = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');

const declaration = { hfs: 3, kind: 'app', project: 'demo', edition: 'full', sides: { be: { apps: [{ name: 'api', kind: 'api' }] }, fe: { grammar: 'core', apps: [{ name: 'web', kind: 'next' }] } } };

/** The files of the fixture app; the untracked ones (generated code) are written after the commit. */
export const FILES: Readonly<Record<string, string>> = {
  'hfs.json': JSON.stringify(declaration),
  '.gitignore': '__generated__/\nnode_modules/\n',
  'README.md': '# demo\n\nSee `be/src/notes.ts`.\n',
  'be/tsconfig.json': JSON.stringify({ compilerOptions: { strict: true }, include: ['src/**/*.ts'] }),
  'be/src/notes.ts': 'export const notes = 1;\n',
  'be/src/other.ts': 'export const other = 2;\n',
  'fe/tsconfig.json': JSON.stringify({ compilerOptions: { strict: true }, include: ['src/**/*.ts'] }),
  'fe/src/page.ts': 'export const page = 1;\n',
  'fe/src/list.ts': 'export const list = 2;\n',
};

/** The untracked, git-ignored generated code the fe program includes. */
export const GENERATED = 'fe/src/__generated__/graphql.ts';

export function write(root: string, file: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
}

/** A temp git repository holding `files` (committed) and the generated input (not tracked). */
export function appRepo(t: TestContext, files: Readonly<Record<string, string>> = FILES): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-structure-cache-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, ['init', '-q', '-b', 'main']);
  for (const [file, text] of Object.entries(files)) write(root, file, text);
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'c']);
  write(root, GENERATED, 'export const generated = 1;\n');
  // The app's own TypeScript, as an installed app has it: the program inputs of a side are read through it.
  const compiler = createRequire(import.meta.url).resolve('typescript');
  write(root, 'node_modules/typescript/package.json', JSON.stringify({ name: 'typescript', version: '5.9.3', main: 'index.js' }));
  write(root, 'node_modules/typescript/index.js', `module.exports = require(${JSON.stringify(compiler)});\n`);
  return root;
}

/** The architecture machine as a double that counts its runs per side (`calls`) and can act while it runs (`during`). */
export function machineDouble(during?: (side: string) => void): { machine: MachineFn; calls: string[] } {
  const calls: string[] = [];
  const machine: MachineFn = ({ repositoryRoot }) => {
    const side = path.basename(repositoryRoot);
    calls.push(side);
    during?.(side);
    return { ok: true, files: 1, kinds: [], violations: [], errors: [] };
  };
  return { machine, calls };
}

export interface RunOptions {
  readonly hfs?: boolean;
  readonly secrets?: boolean;
  readonly during?: (side: string) => void;
  readonly fingerprint?: typeof PORTABLE;
  readonly tracked?: readonly string[];
}

/** One structure pass over `root` against the committed cache of the work tree; the session is flushed. */
export async function runPass(root: string, options: RunOptions = {}): Promise<{ pass: PassResult; calls: string[]; hfs: readonly CacheRecord[]; secrets: readonly CacheRecord[] }> {
  const tracked = options.tracked ?? trackedFiles(root);
  const session = createDiskSession({ root, tracked, env: {}, progress: silentProgress, fingerprint: options.fingerprint ?? PORTABLE });
  const { machine, calls } = machineDouble(options.during);
  const emit = async () => ({ status: 0, signal: null, stdout: '', stderr: '' });
  const pass = await runStructurePass(session, { repoRoot: root, tracked, hfs: options.hfs ?? true, secrets: options.secrets ?? false, presets: bundledPresets(), machine, execute: emit, harness: { version: '0.0.0' } });
  const flushed = session.flush();
  if (flushed.warnings.length > 0) throw new Error(flushed.warnings.join('; '));
  // What the run left on disk, read back by a fresh session: a record the flush refused (an edit during the run) is not there.
  const written = createDiskSession({ root, tracked, env: {}, progress: silentProgress, fingerprint: options.fingerprint ?? PORTABLE });
  return { pass, calls, hfs: written.records(HFS_FOLDER), secrets: written.records(SECRETS_FOLDER) };
}

/** `path\0step` to hash, for comparing which records a run rewrote. */
export const hashes = (records: readonly CacheRecord[]): Map<string, string> => new Map(records.map((record) => [`${record.path}\0${record.step}`, record.hash]));

/** The record keys whose hash differs between two runs, added or removed ones included. */
export function changed(before: readonly CacheRecord[], after: readonly CacheRecord[]): string[] {
  const a = hashes(before);
  const b = hashes(after);
  return [...new Set([...a.keys(), ...b.keys()])].filter((key) => a.get(key) !== b.get(key)).map((key) => key.replace('\0', ' ')).sort();
}

const METHODS = ['readFileSync', 'existsSync', 'statSync', 'lstatSync', 'readdirSync', 'realpathSync', 'openSync', 'accessSync', 'opendirSync', 'readlinkSync'] as const;

/** Every file-system access `run` makes under `root` (outside node_modules, which the lockfile in the fingerprint stands for), as `method path`. */
export function recordFs<T>(root: string, run: () => T): { value: T; accessed: Set<string> } {
  const base = root.split(path.sep).join('/');
  const accessed = new Set<string>();
  const originals = METHODS.map((name) => [name, fs[name]] as const);
  const table = fs as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const [name, original] of originals) {
    table[name] = function patched(this: unknown, target: unknown, ...rest: unknown[]): unknown {
      if (typeof target === 'string') {
        const absolute = path.resolve(target).split(path.sep).join('/');
        if (absolute.startsWith(`${base}/`) && !absolute.includes('/node_modules/')) accessed.add(`${name} ${absolute.slice(base.length + 1)}`);
      }
      return (original as (...args: unknown[]) => unknown).call(this, target, ...rest);
    };
  }
  module.syncBuiltinESMExports();
  try { return { value: run(), accessed }; } finally {
    for (const [name, original] of originals) table[name] = original as never;
    module.syncBuiltinESMExports();
  }
}

export const filesOf = (accessed: Set<string>): Set<string> => new Set([...accessed].map((entry) => entry.slice(entry.indexOf(' ') + 1)));

/** The fixture of the per-file rules: a secret, a bypass marker, a long source, a README beside a stack manifest and files that are clean. */
export const RULE_FILES: Readonly<Record<string, string>> = {
  ...FILES,
  'be/src/secret.ts': `export const key = '${FAKE_KEY}';\n`,
  'be/src/bypass.ts': '// @ts-ignore\nexport const bypassed: number = "x";\n',
  'be/src/long.ts': `${'export const line = 1;\n'.repeat(600)}`,
  'be/src/clean.ts': 'export const clean = 1;\n',
  'fe/src/secret.ts': `export const key = '${FAKE_KEY}';\n`,
  'fe/src/long.ts': `${'export const line = 1;\n'.repeat(600)}`,
  'docs/README.md': `# docs\n\n${FAKE_KEY}\n`,
  'docs/.starcistacks/application-stacks.yaml': `note: ${FAKE_KEY}\n`,
  '.env': 'TOKEN=abc\n',
};
