// proves: HFS_SIDE_FOLDER_MISSING@lite
// `starci app scaffold <name> --without <side[,side]> [--contract rest]` (PROJECT-1): a project declares any non-empty set of be, fe and packages, and the
// scaffold writes only the declared sides, with the stack declaration's `sides` field and its plain-words line. The lite be+packages rest project passes its
// own check on everything but what needs an installed tree and the REST operation shapes of the starter's doors (R396, an open gap of the starter).
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bundledPresets } from '../sync/index.mjs';
import { scaffoldApp } from '../scaffold/app.mjs';
import type { LockResult } from '../scaffold/app.mjs';
import { ScaffoldError } from '../scaffold/service.mjs';
import { init } from '../runtime/scripts/api/git/init.mjs';
import { checkRepo } from '../runtime/scripts/hfs/check.mjs';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { scaffoldSides } from './main.mjs';
import type { ProjectSide } from '../runtime/scripts/hfs/project-sides.mjs';

const HARNESS = { version: '1.1.0-alpha.3' };
const lockedOk = (root: string): LockResult => {
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  return { ok: true };
};
/** The codes the rest starter raises beyond a default starter: its doors carry no REST operation shapes yet (R396, an open gap of the starter). */
const REST_STARTER_OPEN = new Set(['BE_REST_OPERATION_ID', 'BE_REST_UNTYPED', 'BE_REST_ERROR_SHAPE', 'BE_REST_SECURITY']);

/** A fresh starter of `edition` and `sides` in a temporary folder: its root, files and the codes of its own check. */
function starter(t: TestContext, edition: string, sides?: readonly ProjectSide[], contract?: 'graphql' | 'rest'): { root: string; files: string[]; codes: string[] } {
  const into = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-scaffold-sides-'));
  t.after(() => fs.rmSync(into, { recursive: true, force: true }));
  const { root, files } = scaffoldApp({ name: 'demo', harness: HARNESS, into, edition, presets: bundledPresets(), lock: lockedOk, initGit: init, ...(sides ? { sides } : {}), ...(contract ? { contract } : {}) });
  const codes = checkRepo({ repoRoot: root, harness: HARNESS, files }).findings.filter((finding) => finding.level === 'error').map((finding) => finding.code);
  return { root, files, codes };
}
const read = (root: string, file: string): string => fs.readFileSync(path.join(root, ...file.split('/')), 'utf8');
// reason: hfs.json and package.json are JSON trees the assertions read by key.
const json = (root: string, file: string): Record<string, Record<string, unknown>> => JSON.parse(read(root, file));

test('--without names the sides a new project leaves out: a comma list of be, fe and packages, never all of them', () => {
  assert.deepEqual(scaffoldSides(undefined), ['be', 'fe'], 'the default is the app of both sides and no root packages');
  assert.deepEqual(scaffoldSides('fe'), ['be', 'packages']);
  assert.deepEqual(scaffoldSides('fe,packages'), ['be']);
  assert.deepEqual(scaffoldSides('be'), ['fe', 'packages']);
  assert.throws(() => scaffoldSides('web'), /--without takes a comma list of be, fe, packages \(got web\)/u);
  assert.throws(() => scaffoldSides('fe,fe'), /names a side twice/u);
  assert.throws(() => scaffoldSides('be,fe,packages'), /leaves no side/u);
});

test('the scaffold refuses an empty side set and a rest contract without be', (t) => {
  const into = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-scaffold-sides-'));
  t.after(() => fs.rmSync(into, { recursive: true, force: true }));
  const refused = (sides: readonly ProjectSide[], contract?: 'rest') => assert.throws(() => scaffoldApp({ name: 'demo', harness: HARNESS, into, presets: bundledPresets(), lock: lockedOk, initGit: init, sides, ...(contract ? { contract } : {}) }),
    (error: unknown) => error instanceof ScaffoldError && error.code === 'HFS_SCAFFOLD_SIDES');
  refused([]);
  refused(['fe', 'packages'], 'rest');
});

for (const edition of ['lite', 'full']) {
  test(`a default ${edition} starter declares be and fe, states them in its stack, and raises no side finding`, (t) => {
    const { root, codes } = starter(t, edition);
    assert.deepEqual(Object.keys(json(root, 'hfs.json').sides ?? {}), ['be', 'fe']);
    const stack = read(root, '.starcistacks/application-stacks.yaml');
    assert.match(stack, /^# This project has a back end \(be\) and a front end \(fe\): sides are declared in hfs\.json\.\nsides: \{be: true, fe: true, packages: false\}$/mu);
    assert.deepEqual(codes.filter((code) => /^(?:HFS_SIDE_|STACKS_)/u.test(code)), []);
  });
}

test('lite --without fe --contract rest: a be+packages project whose api app is rest, with no fe tree, GraphQL server or web component', (t) => {
  const { root, files, codes } = starter(t, 'lite', ['be', 'packages'], 'rest');
  const hfs = json(root, 'hfs.json') as unknown as { sides: Record<string, { apps?: unknown[]; optionalSlots?: string[] }> };
  assert.deepEqual(Object.keys(hfs.sides), ['be', 'packages']);
  assert.deepEqual(hfs.sides.packages, {});
  assert.deepEqual(hfs.sides.be!.apps, [{ name: 'api', kind: 'api', contract: 'rest' }]);
  assert.deepEqual(hfs.sides.be!.optionalSlots, ['be.contract.openapi']);
  assert.deepEqual(files.filter((file) => file.startsWith('fe/')), [], 'no fe file is written');
  assert.ok(files.includes('packages/demo-shared/package.json') && files.includes('packages/demo-shared/src/index.ts') && files.includes('packages/demo-shared/tsconfig.json'));
  assert.ok(files.includes('be/apps/api/src/openapi.ts') && files.includes('be/contracts/api/openapi.json'), 'a rest app carries its document head and its committed document');
  assert.equal(JSON.parse(read(root, 'be/contracts/api/openapi.json')).info.title, 'demo');
  const pkg = json(root, 'package.json') as unknown as { workspaces: string[]; dependencies: Record<string, string>; devDependencies: Record<string, string>; scripts: Record<string, string> };
  assert.deepEqual(pkg.workspaces, ['packages/*']);
  for (const name of ['@nestjs/graphql', '@nestjs/apollo', '@apollo/server', 'graphql']) assert.equal(pkg.dependencies[name], undefined, name);
  assert.equal(typeof pkg.dependencies['@nestjs/swagger'], 'string');
  for (const name of ['@starci/eslint-canon-fe', 'tailwindcss', '@types/react']) assert.equal(pkg.devDependencies[name], undefined, name);
  assert.equal(pkg.scripts['build:fe'], undefined);
  assert.equal(pkg.scripts['codegen:graphql'], undefined);
  const stackText = read(root, '.starcistacks/application-stacks.yaml');
  assert.match(stackText, /^# This project has no front end \(fe\): sides are declared in hfs\.json\.\nsides: \{be: true, fe: false, packages: true\}$/mu);
  const stack = parseYaml(stackText);
  assert.equal(stack.components.web, undefined);
  assert.equal(stack.environments.production.deploy.images.web, undefined);
  assert.deepEqual(stack.environments.dev.local.processes.map((process: { name: string }) => process.name), ['api']);
  assert.match(stack.components.api.purpose, /REST API/u);
  assert.equal(parseYaml(read(root, '.starcistacks/production/infra/swarm/stack.yaml')).services.web, undefined);
  assert.doesNotMatch(read(root, '.starcistacks/production/infra/swarm/Caddyfile'), /reverse_proxy web:/u);
  assert.doesNotMatch(read(root, 'README.md'), /`fe\//u);
  assert.equal(fs.existsSync(path.join(root, 'eslint.config.mjs')) && /eslint-canon-fe/u.test(read(root, 'eslint.config.mjs')), false, 'the packages lint config imports no fe canon');
  // A scaffold in a temporary folder (no install, no host custody) raises the same environment findings as a default starter; nothing else but R396.
  const baseline = new Set(starter(t, 'lite').codes);
  assert.deepEqual(codes.filter((code) => !baseline.has(code) && !REST_STARTER_OPEN.has(code)), [], 'its own check raises nothing a default starter does not, but the REST shapes of the starter doors');
});

test('R399 at the check: a declared side whose folder tracks nothing is red', (t) => {
  const { root, files } = starter(t, 'lite', ['be', 'packages'], 'rest');
  const without = files.filter((file) => !file.startsWith('packages/'));
  const codes = checkRepo({ repoRoot: root, harness: HARNESS, files: without }).findings.map((finding) => finding.code);
  assert.ok(codes.includes('HFS_SIDE_FOLDER_MISSING'));
});
