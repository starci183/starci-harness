// The committed check cache is a function of the commit (contexts/project/check-cache.md "Two checkouts, one cache"): two checkouts of one commit write
// byte-identical records into .starcistacks/cache whatever each built or fetched. One checkout is clean; the other has what a framework build leaves (a
// git-ignored environment declaration that imports the build folder's route types, the types themselves, one of them ill-typed) and remote refs that
// moved (origin/dev and origin/main at another commit). Both run the structure pass, the types family with the real tsc, the db family and a project
// check that names a ref, then their committed caches are compared byte for byte; the ref-keyed verdicts are kept machine-local in the tool cache.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { git } from '../cache/git.mjs';
import { silentProgress } from '../cache/progress.mjs';
import { createDiskSession } from '../cache/session.mjs';
import { runStructurePass } from '../cache/hfs-family.mjs';
import { runTypesForApp } from '../cache/app-families.mjs';
import { createTscRunner } from '../cache/types-family.mjs';
import { runDbFamily, DB_FOLDER } from '../cache/db-family.mjs';
import { runProjectChecks } from '../cache/project-checks.mjs';
import { VERDICT_FOLDER } from '../cache/check-verdicts.mjs';
import { sideKey, untrackedProgramInputs } from '../cache/side-key.mjs';
import { hashFile } from '../cache/hash.mjs';
import { CACHE_DIR } from '../cache/types.mjs';
import { readTypeScriptProject } from '../runtime/scripts/hfs/typescript-programs.mjs';
import { trackedFiles, type MachineFn } from '../runtime/scripts/hfs/check.mjs';
import { bundledPresets } from '../sync/index.mjs';
import { nativeTestNode } from './fixtures/heavy-node.mts';

const PORTABLE = { parts: [{ name: 'hfs', sha256: 'h1' }], portable: true, localReasons: [] };
const declaration = { hfs: 3, kind: 'app', project: 'demo', edition: 'full', sides: { be: { apps: [{ name: 'api', kind: 'api' }] }, fe: { grammar: 'core', apps: [{ name: 'web', kind: 'next' }] } } };
const WEB_TSCONFIG = { compilerOptions: { strict: true, target: 'es2022', module: 'esnext', moduleResolution: 'bundler', types: [], noEmit: true }, include: ['next-env.d.ts', 'src/**/*.ts', '.next/types/**/*.ts'] };
const FILES: Readonly<Record<string, string>> = {
  'hfs.json': JSON.stringify(declaration),
  // An app's managed .gitattributes: LF in every checkout, whatever the host's core.autocrlf.
  '.gitattributes': '* text=auto eol=lf\n',
  '.gitignore': '__generated__/\nnode_modules/\nnext-env.d.ts\n.next/\n',
  'be/tsconfig.json': JSON.stringify({ compilerOptions: { strict: true }, include: ['src/**/*.ts'] }),
  'be/src/notes.ts': 'export const notes = 1;\n',
  'fe/tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, types: [] } }),
  'fe/apps/web/tsconfig.json': JSON.stringify(WEB_TSCONFIG),
  'fe/apps/web/src/page.ts': 'import { generated } from "./__generated__/graphql";\nexport const page: number = generated;\n',
  'db/migrations/0001_init.sql': 'create table public.notes (id uuid primary key default gen_random_uuid(), body text not null);\n',
  'ext/manifest.json': JSON.stringify({ checks: [{ id: 'published-seed', run: 'ext/checks/published.mjs', why: 'compares with the published seed', reads: ['db'], refs: ['origin/dev'] }] }),
  'ext/checks/published.mjs': 'process.exit(0);\n',
};
/** Generated code the declared codegen writes: an untracked input every checkout has alike. */
const GENERATED = 'fe/apps/web/src/__generated__/graphql.ts';
/** What `next build` / `next dev` leave in a checkout: git-ignored, and here ill-typed, so a program that read it would record a finding. */
const ARTIFACTS: Readonly<Record<string, string>> = {
  'fe/apps/web/next-env.d.ts': 'import "./.next/types/routes.d.ts";\n',
  'fe/apps/web/.next/types/routes.d.ts': 'declare const routes: readonly string[];\n',
  'fe/apps/web/.next/types/validator.ts': 'export const broken: number = "not a number";\n',
};

function write(root: string, file: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
}

const commit = (root: string, message: string): void => {
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', message]);
};

/** The remote: an older commit (other db inputs), then the commit both checkouts hold, on main and dev. Returns its folder and the older sha. */
function origin(t: TestContext): { remote: string; older: string } {
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-determinism-origin-'));
  t.after(() => fs.rmSync(remote, { recursive: true, force: true }));
  git(remote, ['init', '-q', '-b', 'main']);
  for (const [file, text] of Object.entries(FILES)) write(remote, file, file.startsWith('db/') ? 'create table public.notes (id uuid primary key default gen_random_uuid());\n' : text);
  commit(remote, 'older');
  const older = git(remote, ['rev-parse', 'HEAD']).stdout.trim();
  for (const [file, text] of Object.entries(FILES)) write(remote, file, text);
  commit(remote, 'the commit');
  git(remote, ['branch', 'dev']);
  return { remote, older };
}

/** A checkout of the remote's main with the app's TypeScript installed and the generated code written (`npm ci`, `npm run codegen`). */
function checkout(t: TestContext, remote: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-determinism-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(path.dirname(root), ['clone', '-q', remote, root]);
  write(root, GENERATED, 'export const generated = 1;\n');
  const compiler = createRequire(import.meta.url).resolve('typescript');
  write(root, 'node_modules/typescript/package.json', JSON.stringify({ name: 'typescript', version: '5.9.3', main: 'index.js' }));
  write(root, 'node_modules/typescript/index.js', `module.exports = require(${JSON.stringify(compiler)});\n`);
  return root;
}

const machine: MachineFn = () => ({ ok: true, files: 1, kinds: [], violations: [], errors: [] });

/** One `app check` over the families this spec covers, against the cache in the work tree; returns what the flush wrote into the committed cache. */
async function check(root: string): Promise<{ written: readonly string[]; removed: readonly string[]; typeFindings: number; reports: string[] }> {
  const tracked = trackedFiles(root);
  const env = { STARCI_CACHE_HOME: path.join(root, 'node_modules', '.tool-cache') };
  const session = createDiskSession({ root, tracked, env, progress: silentProgress, journalRoot: false, fingerprint: PORTABLE });
  const emit = async () => ({ status: 0, signal: null, stdout: '', stderr: '' });
  await runStructurePass(session, { repoRoot: root, tracked, hfs: true, secrets: false, presets: bundledPresets(), machine, execute: emit, harness: { version: '0.0.0' } });
  const tsc = createTscRunner({ appRoot: root, typescriptFrom: path.resolve(import.meta.dirname, '..', 'package.json'), execute: nativeTestNode });
  const types = await runTypesForApp(session, { repoRoot: root, tracked, env, tsc });
  await runDbFamily(session, { repoRoot: root, tracked });
  await runProjectChecks({ repoRoot: root, env, session, run: async () => ({ status: 0, stdout: '', stderr: '' }) });
  const flushed = session.flush();
  assert.deepEqual(flushed.warnings, []);
  return { written: flushed.written, removed: flushed.removed, typeFindings: types.result.findings.length, reports: session.reports.map((r) => `${r.family} ${r.mode} ${r.reason}`) };
}

/** Every committed cache file of a checkout, path to bytes. */
function committedCache(root: string): Map<string, string> {
  const base = path.join(root, ...CACHE_DIR.split('/'));
  const out = new Map<string, string>();
  for (const name of fs.readdirSync(base, { recursive: true, encoding: 'utf8' }).sort()) {
    const file = path.join(base, name);
    if (fs.statSync(file).isFile()) out.set(name.split(path.sep).join('/'), fs.readFileSync(file, 'utf8'));
  }
  return out;
}

test('a checkout of the cache-warm commit with build artifacts and moved remote refs writes nothing into the committed cache', { timeout: 300000 }, async (t) => {
  const { remote, older } = origin(t);
  // The warm commit: a clean checkout runs and commits what it wrote until a run writes nothing (`app push`, three rounds at most).
  const clean = checkout(t, remote);
  let rounds = 0;
  for (;;) {
    const run = await check(clean);
    assert.equal(run.typeFindings, 0, 'the clean checkout type-checks');
    if (run.written.length + run.removed.length === 0) break;
    rounds += 1;
    assert.ok(rounds <= 3, 'the cache converges');
    commit(clean, 'chore(cache): warm the check cache');
  }
  const files = [...committedCache(clean).keys()];
  assert.ok(files.some((file) => file.startsWith('check/types/')), `the types family recorded: ${files.join(', ')}`);
  assert.ok(!files.some((file) => file.startsWith(`${DB_FOLDER}/`)), 'the db record is machine-local, never committed');
  const verdicts = [...committedCache(clean)].filter(([file]) => file.startsWith(`${VERDICT_FOLDER}/`)).map(([, text]) => text).join('');
  assert.ok(!verdicts.includes('project-check/published-seed'), 'a verdict keyed on a ref is machine-local, never committed');
  const kept = fs.readdirSync(path.join(clean, 'node_modules', '.tool-cache'), { recursive: true, encoding: 'utf8' }).map((name) => name.split(path.sep).join('/'));
  assert.ok(kept.some((name) => name.endsWith('local-records/check/db.jsonl')), `the db record is kept locally: ${kept.join(', ')}`);

  // Another checkout of that commit, after a framework build and with other remote refs fetched.
  const built = checkout(t, clean);
  for (const [file, text] of Object.entries(ARTIFACTS)) write(built, file, text);
  git(built, ['update-ref', 'refs/remotes/origin/dev', older]);
  git(built, ['update-ref', 'refs/remotes/origin/main', older]);
  const other = await check(built);
  assert.equal(other.typeFindings, 0, 'the build artifacts are no part of the program: their ill-typed file is not read');
  assert.deepEqual([...other.written, ...other.removed], [], 'the run writes nothing into the committed cache');
  assert.equal(git(built, ['status', '--porcelain', '--', CACHE_DIR]).stdout.trim(), '', 'git status of the cache stays clean');
  assert.deepEqual([...committedCache(built)], [...committedCache(clean)], 'the committed records are the same bytes');
});

test('a program and a side key leave the build artifacts out and keep the generated code', (t) => {
  const { remote } = origin(t);
  const root = checkout(t, remote);
  for (const [file, text] of Object.entries(ARTIFACTS)) write(root, file, text);
  const ts = createRequire(import.meta.url)('typescript') as typeof import('typescript');
  const { parsed } = readTypeScriptProject(ts, path.join(root, 'fe', 'apps', 'web', 'tsconfig.json'));
  const names = (parsed?.fileNames ?? []).map((file) => path.relative(root, file).split(path.sep).join('/')).sort();
  assert.deepEqual(names, [GENERATED, 'fe/apps/web/src/page.ts']);
  assert.deepEqual(untrackedProgramInputs(root, 'fe', new Set(trackedFiles(root))), [GENERATED]);
});

test('a side key stands for generated code by its codegen inputs, so the gate rewriting it mid-run (types codegen) keeps the key', (t) => {
  const { remote } = origin(t);
  const root = checkout(t, remote);
  const index = () => ({ paths: trackedFiles(root), hashOf: (file: string) => hashFile(path.join(root, file)) });
  assert.ok(sideKey(root, index(), 'fe').inputs.includes(GENERATED), 'with no codegen declared the generated file is keyed by its bytes');
  write(root, 'package.json', JSON.stringify({ name: 'demo', private: true, scripts: { codegen: 'graphql-codegen' } }));
  // The schema the codegen reads lives outside the side: only the codegen part of the key can see it.
  write(root, 'contracts/schema.graphql', 'type Query { notes: Int }\n');
  commit(root, 'declare the codegen');
  const before = sideKey(root, index(), 'fe');
  assert.ok(!before.inputs.includes(GENERATED), 'generated output is no input of its own');
  write(root, GENERATED, 'export const generated = 2;\n');
  assert.equal(sideKey(root, index(), 'fe').key, before.key, 'codegen rewrote its output: the key holds');
  fs.rmSync(path.join(root, GENERATED));
  assert.equal(sideKey(root, index(), 'fe').key, before.key, 'a tree whose codegen has not run yet has the same key');
  write(root, 'contracts/schema.graphql', 'type Query { notes: String }\n');
  assert.notEqual(sideKey(root, index(), 'fe').key, before.key, 'a changed codegen input re-keys the side');
});
