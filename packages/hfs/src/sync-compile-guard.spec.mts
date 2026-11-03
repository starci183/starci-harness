// `starci app sync --execute` never leaves an app uncompilable: the writes of each managed group are compiled with the side's own TypeScript
// over the disk, a group whose writes add an error (in its own files or in a file that imports one) is held whole and named with the errors,
// a retired file still imported is kept, an error the app already had is not the render's, and a side without TypeScript is named, not judged.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { GROUP_HELD, RETIRED_GROUP, guardWrites, heldLines, isGuardedSource, projectOf, type GuardedWrite } from '../sync/compile-guard.mjs';
import { runSync } from '../sync/index.mjs';
import { scaffoldApp } from '../scaffold/app.mjs';
import type { LockResult } from '../scaffold/app.mjs';
import { bundledPresets } from '../sync/index.mjs';
import { init } from '../runtime/scripts/api/git/init.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

const TSCONFIG = `${JSON.stringify({ compilerOptions: { strict: true, noEmit: true, module: 'esnext', moduleResolution: 'bundler', target: 'es2022', skipLibCheck: true, types: [] }, include: ['src'] })}\n`;

/** An app whose back end and two front-end projects each compile on their own. */
function app(t: TestContext): string {
  const root = mkdtemp(t, 'starci-compile-guard-');
  const files: Record<string, string> = {
    'be/tsconfig.json': TSCONFIG,
    'be/src/glue.ts': 'export const kept = 1\nexport const dropped = 2\n',
    'be/src/app.ts': 'import { kept, dropped } from "./glue"\nexport const total = kept + dropped\n',
    'be/src/old.ts': 'export const old = 3\n',
    'be/src/uses-old.ts': 'import { old } from "./old"\nexport const again = old\n',
    'be/src/broken.ts': 'import { nothing } from "./glue"\nexport const none = nothing\n',
    'fe/apps/web/tsconfig.json': TSCONFIG,
    'fe/apps/web/src/client.ts': 'export const session = "s"\n',
    'fe/apps/web/src/page.ts': 'import { session } from "./client"\nexport const shown = session\n',
    'fe/packages/ui/tsconfig.json': TSCONFIG,
  };
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}

test('a group whose writes add an error is held whole, on every side, with the errors it adds; the other groups go through', (t) => {
  const root = app(t);
  const writes: GuardedWrite[] = [
    { path: 'be/src/glue.ts', group: 'auth', text: 'export const kept = 1\n' },
    { path: 'fe/apps/web/src/client.ts', group: 'auth', text: 'export const other = "o"\n' },
    { path: 'be/src/fresh.ts', group: 'clock', text: 'import { kept } from "./glue"\nexport const fresh = kept\n' },
    { path: 'be/src/self.ts', group: 'mail', text: 'import { missing } from "./glue"\nexport const own = missing\n' },
    { path: 'be/src/old.ts', group: RETIRED_GROUP, text: null },
    { path: 'be/src/data.json', group: 'auth', text: '{}\n' },
    { path: 'docs/notes.ts', group: 'auth', text: 'export {}\n' },
    { path: 'fe/notes.ts', group: 'auth', text: 'export {}\n' },
    { path: 'fe/apps/admin/src/x.ts', group: 'auth', text: 'export {}\n' },
    { path: 'fe/packages/ui/src/button.ts', group: 'ui', text: 'export const button = 1\n' },
  ];
  const verdict = guardWrites(root, writes, (dir) => (dir.endsWith(path.join('fe', 'packages', 'ui')) ? null : ts));
  assert.deepEqual(verdict.unchecked, ['fe/packages/ui/tsconfig.json']);
  const held = Object.fromEntries(verdict.held.map((group) => [group.group, group]));
  assert.deepEqual(Object.keys(held).sort(), ['auth', 'mail', RETIRED_GROUP]);
  assert.deepEqual(held.auth?.files, ['be/src/glue.ts', 'fe/apps/web/src/client.ts']);
  assert.ok(held.auth?.errors.some((error) => /^be\/src\/app\.ts:1 TS2305 .*'dropped'/.test(error)), held.auth?.errors.join('\n'));
  assert.ok(held.auth?.errors.some((error) => /^fe\/apps\/web\/src\/page\.ts:1 TS\d+ .*'session'/.test(error)), held.auth?.errors.join('\n'));
  assert.ok(!held.auth?.errors.some((error) => error.includes('broken.ts')), 'an error the app already had is not the render\'s');
  assert.match(held.mail?.errors.join('\n') ?? '', /^be\/src\/self\.ts:1 TS2305 .*'missing'/);
  assert.deepEqual(held[RETIRED_GROUP]?.files, ['be/src/old.ts']);
  assert.match(held[RETIRED_GROUP]?.errors.join('\n') ?? '', /^be\/src\/uses-old\.ts:1 TS2307 /);
});

test('the writes that compile hold nothing, a moved line is the same error, and a side with no tsconfig compiles nothing', (t) => {
  const root = app(t);
  const verdict = guardWrites(root, [
    { path: 'be/src/broken.ts', group: 'auth', text: '\n\nimport { nothing } from "./glue"\nexport const none = nothing\n' },
    { path: 'be/src/glue.ts', group: 'auth', text: 'export const kept = 1\nexport const dropped = 2\nexport const added = 3\n' },
  ], () => ts);
  assert.deepEqual(verdict, { held: [], unchecked: [] });
  assert.deepEqual(guardWrites(root, [], () => ts), { held: [], unchecked: [] });
  fs.rmSync(path.join(root, 'be', 'tsconfig.json'));
  assert.equal(projectOf(root, 'be/src/glue.ts'), null);
  assert.deepEqual(guardWrites(root, [{ path: 'be/src/glue.ts', group: 'auth', text: '' }], () => ts), { held: [], unchecked: [] });
  assert.deepEqual(['be/src/a.ts', 'fe/apps/web/src/b.tsx', 'be/src/c.d.ts', 'be/src/d.json', 'docs/e.ts'].map(isGuardedSource), [true, true, false, false, false]);
});

test('a held group prints its files, its first errors, how many more, and what to do', () => {
  const errors = Array.from({ length: 23 }, (_, index) => `be/src/a.ts:${String(index + 1)} TS2305 missing`);
  const lines = heldLines({ group: 'auth-lite', files: ['be/src/a.ts'], errors });
  assert.equal(lines[0], `${GROUP_HELD} auth-lite: 1 files not written, the render adds 23 type errors to the app (be/src/a.ts)`);
  assert.equal(lines.filter((line) => line.startsWith('  be/src/a.ts')).length, 20);
  assert.ok(lines.includes('  ... 3 more'));
  assert.match(lines.at(-1) as string, /then run "npx --no-install starci app sync --execute" again$/);
  assert.equal(heldLines({ group: 'g', files: [], errors: ['x'] }).some((line) => line.includes('more')), false);
});

const lockedOk = (root: string): LockResult => {
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  return { ok: true };
};

test('sync --execute holds the managed sign-in glue an app\'s own code still reads, writes it once the app no longer does', async (t) => {
  const root = scaffoldApp({ name: 'demo', into: mkdtemp(t, 'starci-compile-guard-sync-'), harness: { version: '1.1.0-alpha.3' }, edition: 'lite', presets: bundledPresets(), lock: lockedOk, initGit: init }).root;
  const glue = path.join(root, 'be', 'src', 'modules', 'domain', 'identity', 'persistence', 'entities', 'index.ts');
  const rendered = fs.readFileSync(glue, 'utf8');
  fs.writeFileSync(glue, `${rendered}export const legacyToken = "kept by the app"\n`);
  const reader = path.join(root, 'be', 'src', 'modules', 'domain', 'identity', 'legacy-reader.ts');
  fs.writeFileSync(reader, 'import { legacyToken } from "./persistence/entities"\nexport const read = legacyToken\n');
  fs.mkdirSync(path.join(root, 'be', 'node_modules'), { recursive: true });
  // The app's TypeScript is this package's, linked; the link is removed as a link, never through it.
  const link = path.join(root, 'be', 'node_modules', 'typescript');
  fs.symlinkSync(fs.realpathSync(path.join(import.meta.dirname, '..', 'node_modules', 'typescript')), link, 'junction');
  t.after(() => fs.rmSync(link, { force: true }));
  const out: string[] = [];
  assert.equal(await runSync(['--execute'], { cwd: root, presets: bundledPresets(), out: (line) => out.push(line) }), 1);
  assert.match(out.join('\n'), new RegExp(`^${GROUP_HELD} auth-lite: \\d+ files not written`, 'm'));
  assert.match(out.join('\n'), /legacy-reader\.ts:1 TS2305 .*'legacyToken'/);
  assert.match(out.at(-1) as string, /written, \d+ already in sync, \d+ held$/);
  assert.match(fs.readFileSync(glue, 'utf8'), /legacyToken/, 'the held file is not written');
  fs.rmSync(reader);
  const again: string[] = [];
  assert.equal(await runSync(['--execute'], { cwd: root, presets: bundledPresets(), out: (line) => again.push(line) }), 0, again.join('\n'));
  assert.equal(fs.readFileSync(glue, 'utf8'), rendered);
  fs.writeFileSync(glue, `${rendered}// a hand edit\n`);
  const unchecked: string[] = [];
  assert.equal(await runSync(['--execute'], { cwd: root, presets: bundledPresets(), loadTs: () => null, out: (line) => unchecked.push(line) }), 0);
  assert.match(unchecked.join('\n'), /^notice: the writes compiled by be\/tsconfig\.json were not type-checked/m);
});
