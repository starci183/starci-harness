// The app verbs that work on one side refuse a project that does not declare it (PROJECT-1, runtime/scripts/hfs/side-gate.mts): SIDE_NOT_DECLARED,
// exit 2, before any folder is read or written. One case per family: the back-end verbs (emit, db, world, add of a back-end noun), the
// front-end verbs (add of a front-end unit, stack build-args, a table with --fe) and `check --side`.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from './main.mjs';
import { addNounSides } from '../runtime/scripts/hfs/side-gate.mjs';

const HARNESS = { version: '1.1.0-alpha.3' };

/** A folder holding only an hfs.json of `sides`. */
function project(t: TestContext, sides: Record<string, unknown>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-side-gate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'hfs.json'), JSON.stringify({ hfs: 3, kind: 'app', edition: 'lite', project: 'demo', sides }));
  return root;
}

async function refused(root: string, argv: string[], side: string): Promise<void> {
  let err = '';
  const code = await main([...argv, '--cwd', root], { harness: HARNESS, stderr: (text: string) => { err += text; }, stdout: () => {} });
  assert.equal(code, 2, argv.join(' '));
  assert.match(err, new RegExp(`^SIDE_NOT_DECLARED: starci app ${argv.slice(0, 2).join(' ').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}.* works on the ${side} side, which hfs\\.json does not declare`, 'u'), argv.join(' '));
  assert.deepEqual(fs.readdirSync(root), ['hfs.json'], `${argv.join(' ')} writes nothing`);
}

const BE_ONLY = { be: { apps: [{ name: 'api', kind: 'api' }] }, packages: {} };
const FE_ONLY = { fe: { apps: [{ name: 'web', kind: 'next' }] } };

test('the back-end verbs refuse a project without be', async (t) => {
  const root = project(t, FE_ONLY);
  await refused(root, ['emit'], 'be');
  await refused(root, ['db', 'migrate'], 'be');
  await refused(root, ['world', 'up'], 'be');
  await refused(root, ['add', 'api', 'orders'], 'be');
  await refused(root, ['add', 'cli', 'report'], 'be');
  await refused(root, ['check', '--side', 'be'], 'be');
});

test('the front-end verbs refuse a project without fe', async (t) => {
  const root = project(t, BE_ONLY);
  await refused(root, ['add', 'page', 'orders'], 'fe');
  await refused(root, ['add', 'block', 'summary'], 'fe');
  await refused(root, ['add', 'table', 'orders', '--fe'], 'fe');
  await refused(root, ['stack', 'build-args', '--env', 'production'], 'fe');
  await refused(root, ['check', '--side', 'fe'], 'fe');
});

test('the sides of each add noun', () => {
  assert.deepEqual(addNounSides('table'), ['be']);
  assert.deepEqual(addNounSides('table', { fe: true }), ['be', 'fe']);
  assert.deepEqual(addNounSides('app', { kind: 'next' }), ['fe']);
  assert.deepEqual(addNounSides('app', { kind: 'api' }), ['be']);
  assert.deepEqual(addNounSides('image'), [], 'an image is built for whatever apps the project declares');
});
