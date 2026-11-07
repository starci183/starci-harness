import test from 'node:test';
import { nativeTestNode } from './fixtures/heavy-node.mts';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main, USAGE } from './main.mjs';
import { FAMILIES, type FamilyId } from '../cache/types.mjs';
import { DEFAULT_FAMILIES } from '../cache/run.mjs';

const PROBE = 'parser selection reached the HFS boundary';

function fixture(t: TestContext): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-gate-parser-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

/** Stops at the real dispatch boundary: parser tests neither run nor predict a quality gate. */
async function probe(t: TestContext, argv: string[]) {
  const root = fixture(t);
  const calls: { selected: FamilyId[]; full: FamilyId[] | null }[] = [];
  let err = '';
  const code = await main(['check', ...argv], {
    cwd: root, env: { STARCI_CACHE_HOME: path.join(root, 'tool-cache') }, stdout: () => {}, stderr: (text) => { err += text; },
    checkApp: ({ selected, full }: { selected: Set<FamilyId>; full?: Set<FamilyId> }) => {
      calls.push({ selected: [...selected], full: full === undefined ? null : [...full] });
      throw new Error(PROBE);
    },
  });
  return { code, err, calls, files: fs.readdirSync(root) };
}

test('the public gate choices retain the nine core families a plain check runs, and the CI parity families only the pre-push gate adds', async (t) => {
  assert.deepEqual(FAMILIES, ['hfs', 'format', 'db', 'secrets', 'wiring', 'types', 'lint', 'test', 'sonar', 'build', 'audit']);
  assert.deepEqual(DEFAULT_FAMILIES, FAMILIES.filter((family) => family !== 'build' && family !== 'audit'));
  const result = await probe(t, []);
  assert.equal(result.code, 2);
  assert.match(result.err, new RegExp(PROBE));
  assert.deepEqual(result.calls, [{ selected: [...FAMILIES], full: null }], 'a run with no selector is whole: every family, the CI-parity ones included');
  const lines = USAGE.split('\n').filter((line) => line.startsWith('starci app check '));
  assert.ok(lines.some((line) => line.includes('[--gate <hfs|format|db|secrets|wiring|types|lint|test|sonar|build|audit|codecov>]...')));
  assert.ok(lines.some((line) => line.includes('[--fresh]')));
  for (const old of [...FAMILIES.map((gate) => `--${gate}`), '--full']) assert.ok(lines.every((line) => !line.includes(`[${old}]`)), old);
});

test('gate values accept separate and inline forms and deduplicate the existing combined quality family', async (t) => {
  const result = await probe(t, ['--gate', 'codecov', '--gate=hfs', '--gate', 'codecov', '--gate=sonar']);
  assert.match(result.err, new RegExp(PROBE));
  assert.deepEqual(result.calls, [{ selected: ['sonar', 'hfs'], full: null }]);
  for (const gate of ['sonar', 'codecov']) {
    const one = await probe(t, ['--gate', gate, '--fresh']);
    assert.deepEqual(one.calls, [{ selected: ['sonar'], full: ['sonar'] }]);
  }
});

test('--fresh recomputes exactly the selected gates (every family when none is selected) and writes the refreshed records', async (t) => {
  const selected = await probe(t, ['--gate', 'format', '--gate=format', '--fresh']);
  assert.deepEqual(selected.calls, [{ selected: ['format'], full: ['format'] }]);
  const every = await probe(t, ['--fresh']);
  assert.deepEqual(every.calls, [{ selected: [...FAMILIES], full: [...FAMILIES] }]);
});

test('missing, empty, unknown and retired selectors refuse before a check or cache write', async (t) => {
  const invalid = [
    ['--gate'], ['--gate='], ['--gate', '--json'], ['--gate', ''], ['--gate', ' '],
    ['--gate', 'bogus'], ['--gate=hfs,lint'], ['--no-cache'], ['--no-cache=false'], ['--fresh=false'],
    ...[...FAMILIES.map((gate) => `--${gate}`), '--codecov', '--full'].map((flag) => [flag]),
  ];
  for (const argv of invalid) {
    const result = await probe(t, argv);
    assert.equal(result.code, 2, argv.join(' '));
    assert.deepEqual(result.calls, [], argv.join(' '));
    assert.deepEqual(result.files, [], 'a refused selector performs no work');
  }
});

test('staged checks cannot combine gate selection, fresh or whole-check modifiers', async (t) => {
  for (const argv of [['--gate', 'hfs'], ['--fresh'], ['--json'], ['--shard', '1/2'], ['--coverage-from', 'report.lcov']]) {
    const result = await probe(t, ['--staged', ...argv]);
    assert.equal(result.code, 2);
    assert.match(result.err, /pre-commit guard alone/);
    assert.deepEqual(result.calls, []);
    assert.deepEqual(result.files, []);
  }
});

test('shards require only gate=test and valid safe integer bounds before opening Jest', async (t) => {
  for (const argv of [
    ['--shard', '1/2'], ['--gate', 'hfs', '--shard', '1/2'], ['--gate', 'test', '--gate', 'lint', '--shard', '1/2'],
    ['--gate', 'test', '--shard', '1/2', '--coverage-from', 'report.lcov'],
    ...['0/2', '3/2', '1/0', '-1/2', '1/x', '1/9007199254740992'].map((shard) => ['--gate', 'test', '--shard', shard]),
  ]) {
    const result = await probe(t, argv);
    assert.equal(result.code, 2);
    assert.match(result.err, /--shard/);
    assert.deepEqual(result.calls, []);
    assert.deepEqual(result.files, []);
  }
});

test('a canonical test-only shard dispatches the unchanged full-unit arguments with optional no-cache', async (t) => {
  const root = fixture(t);
  const bin = path.join(root, 'node_modules', 'jest', 'bin');
  const receipt = path.join(root, 'shard-arguments.json');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(path.join(root, 'be'));
  fs.writeFileSync(path.join(root, 'be', 'package.json'), '{}');
  fs.writeFileSync(path.join(bin, '..', 'package.json'), JSON.stringify({ name: 'jest', exports: { './bin/jest': './bin/jest.cjs' } }));
  fs.writeFileSync(path.join(bin, 'jest.cjs'), `require('node:fs').writeFileSync(${JSON.stringify(receipt)}, JSON.stringify({ argv: process.argv.slice(2), shard: process.env.STARCI_COVERAGE_SHARD }));`);
  for (const extra of [[]]) {
    let err = '';
    const code = await main(['check', '--gate', 'test', '--gate=test', '--shard', '1/2', ...extra], { cwd: root, env: {}, runHeavyNode: nativeTestNode, stdout: () => {}, stderr: text => { err += text; } });
    assert.equal(code, 0, err);
    const actual: { argv: string[]; shard: string } = JSON.parse(fs.readFileSync(receipt, 'utf8'));
    assert.ok(actual.argv.includes('--shard=1/2'));
    assert.ok(actual.argv.includes('--coverage'));
    assert.ok(actual.argv.includes('--ci'));
    const projects = actual.argv.indexOf('--selectProjects');
    assert.ok(projects >= 0);
    assert.equal(actual.argv[projects + 1], 'unit');
    assert.equal(actual.shard, '1');
  }
});

test('coverage-from alone judges no gate while explicit gates remain selected beside it', async (t) => {
  const alone = await probe(t, ['--coverage-from', 'merged.lcov']);
  assert.deepEqual(alone.calls, [{ selected: [], full: null }]);
  const selected = await probe(t, ['--coverage-from', 'merged.lcov', '--gate', 'format', '--fresh']);
  assert.deepEqual(selected.calls, [{ selected: ['format'], full: ['format'] }]);
});

test('--fresh is the one escape hatch: it recomputes every family, or the selected ones, and takes a side', async (t) => {
  const everything = await probe(t, ['--fresh']);
  assert.deepEqual(everything.calls, [{ selected: [...FAMILIES], full: [...FAMILIES] }]);
  const scoped = await probe(t, ['--fresh', '--gate', 'hfs', '--side', 'be']);
  assert.deepEqual(scoped.calls, [{ selected: ['hfs'], full: ['hfs'] }]);
  const usage = USAGE.split('\n');
  assert.ok(usage.some((line) => line.startsWith('starci app check ') && line.includes('[--fresh]')));
  assert.ok(usage.every((line) => !line.includes('--no-cache')), 'no --no-cache anywhere in the usage');
});
