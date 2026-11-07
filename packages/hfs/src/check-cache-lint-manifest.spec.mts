// The lint cache and the app's own manifest: the back-end canon reads the dependency names, workspaces and local references of the app root's package.json for every source
// file (cross-file input of third-party-import-owner), never a registry version. Raising a pin must therefore not lint every file again; changing what a rule reads must.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { createFakeSession } from '../cache/fake-session.mjs';
import { lintSide, manifestIdentity, type CanonDeclarations, type EslintResult } from '../cache/lint-family.mjs';
import type { CacheRecord } from '../cache/types.mjs';

const manifest = (dependencies: Record<string, string>, extra: Record<string, unknown> = {}): string => `${JSON.stringify({ name: 'app', private: true, version: '0.0.1', dependencies, devDependencies: { '@starci/hfs': '6.0.1' }, ...extra }, null, 2)}\n`;

test('a registry version is no part of the manifest identity; a name, a workspace entry or a local reference is', () => {
  const base = manifestIdentity(manifest({ zod: '4.6.7', 'starci-harness': '1.1.0-alpha.83' }));
  assert.ok(base !== undefined);
  assert.equal(manifestIdentity(manifest({ zod: '4.6.8', 'starci-harness': '1.1.0-alpha.84' })), base, 'raising pins changes nothing a rule can read');
  assert.equal(manifestIdentity(manifest({ zod: '^4.0.0', 'starci-harness': '1.1.0-alpha.83' })), base, 'nor does the range a version is written as');
  assert.notEqual(manifestIdentity(manifest({ zod: '4.6.7', 'starci-harness': '1.1.0-alpha.83', pg: '8.0.0' })), base, 'a new dependency is a new SDK the owner rule judges');
  assert.notEqual(manifestIdentity(manifest({ zod: '4.6.7' })), base, 'a removed one too');
  assert.notEqual(manifestIdentity(manifest({ zod: 'workspace:*', 'starci-harness': '1.1.0-alpha.83' })), base, 'a workspace reference makes the package first-party');
  assert.notEqual(manifestIdentity(manifest({ zod: 'npm:other@1.0.0', 'starci-harness': '1.1.0-alpha.83' })), base, 'an alias names another package');
  assert.notEqual(manifestIdentity(manifest({ zod: '4.6.7', 'starci-harness': '1.1.0-alpha.83' }, { workspaces: ['packages/*'] })), base, 'a workspace entry changes which names are first-party');
  assert.equal(manifestIdentity('not json'), undefined);
});

const canon: CanonDeclarations = {
  name: 'fake-canon',
  crossFileInputs: [{ rule: 'third-party-import-owner', kind: 'content', relativeTo: 'side', globs: ['package.json', '../package.json'], appliesTo: ['**/*.ts'] }],
  graphRules: false,
  projectGraph: null,
};

/** An app with a back-end side of six files and a root manifest, linted over `records`; answers what the linter was asked and the records written. */
async function lint(app: string, records: readonly CacheRecord[]): Promise<{ asked: (readonly string[] | null)[]; written: readonly CacheRecord[] | undefined }> {
  const side = path.join(app, 'be');
  const scope = fs.readdirSync(side).filter((file) => file.endsWith('.ts')).sort();
  const files: Record<string, string> = { 'package.json': fs.readFileSync(path.join(app, 'package.json'), 'utf8') };
  for (const file of scope) files[`be/${file}`] = fs.readFileSync(path.join(side, file), 'utf8');
  const session = createFakeSession({ files, records: { 'lint/be': records }, root: app });
  const asked: (readonly string[] | null)[] = [];
  await lintSide({
    session, side: 'be', sideRoot: side, scope, stylesheets: [], canons: [canon], styleCanon: null, typescript: () => ts, extraKey: '', full: null, write: true,
    eslint: async (list): Promise<{ results: EslintResult[]; errors: string[] }> => {
      asked.push(list);
      return { results: (list ?? scope).map((file) => ({ filePath: path.join(side, file), messages: [] })), errors: [] };
    },
    stylelint: null,
  });
  return { asked, written: session.replaced.get('lint/be') };
}

test('a raised pin in the root manifest does not lint the side again; a changed dependency name does', async (t) => {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-lint-manifest-'));
  t.after(() => fs.rmSync(app, { recursive: true, force: true }));
  fs.mkdirSync(path.join(app, 'be'));
  fs.writeFileSync(path.join(app, 'be', 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler', target: 'es2022', strict: true } }));
  for (const name of ['a', 'b', 'c', 'd', 'e', 'f']) fs.writeFileSync(path.join(app, 'be', `${name}.ts`), `export const ${name} = 1\n`);
  fs.writeFileSync(path.join(app, 'package.json'), manifest({ zod: '4.6.7', 'starci-harness': '1.1.0-alpha.83' }));

  const first = await lint(app, []);
  assert.deepEqual(first.asked, [null], 'a cold side is linted whole');
  const records = first.written ?? [];

  // One source file changes (so the side is not unchanged) and the pins of the manifest are raised.
  fs.writeFileSync(path.join(app, 'be', 'f.ts'), 'export const f = 2\n');
  fs.writeFileSync(path.join(app, 'package.json'), manifest({ zod: '4.6.8', 'starci-harness': '1.1.0-alpha.84' }));
  const raised = await lint(app, records);
  assert.deepEqual(raised.asked, [['f.ts']], 'only the file that changed: the raised pins are no input of any file');

  fs.writeFileSync(path.join(app, 'package.json'), manifest({ zod: '4.6.8', 'starci-harness': '1.1.0-alpha.84', pg: '8.0.0' }));
  const added = await lint(app, records);
  assert.equal(added.asked.flat().length, 6, 'a new dependency changes what the owner rule says of every file, so every file is linted again');
});
