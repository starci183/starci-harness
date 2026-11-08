// Spec: `app check --env local|prod` and the source key of a harness package (check-cache.md "The fingerprint", "Trust", "The operating procedure").
//  - a harness or tool package is keyed by the source digest its manifest carries, so the local-registry build and the npm build of one source yield identical keys, a source change yields different ones,
//    and a run on the local build leaves records that stay valid after `deps install-local --restore`, which CI trusts;
//  - a local-registry install without a digest (an old build) has no portable fingerprint;
//  - the findings only a local-registry loop causes are listed once, by failure-codes.yaml (`localOnly`): `local` reports them, `prod` blocks them, and a code error is red in both;
//  - the managed hook, the CI templates and the release gate judge as prod.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeFingerprint, differencesByFamily, fingerprintDifferences, SOURCE_FIELD } from '../cache/fingerprint.mjs';
import { freshnessFindings, UNPORTABLE } from '../cache/freshness.mjs';
import { keyWithReads, readsContext } from '../cache/package-closure.mjs';
import { createDiskSession } from '../cache/session.mjs';
import { silentProgress } from '../cache/progress.mjs';
import { readCacheDir } from '../cache/trust.mjs';
import { hashText } from '../cache/hash.mjs';
import { git } from '../cache/git.mjs';
import { APP_CHECK_COMMAND } from '../release/gate.mjs';
import { pinFindings } from '../runtime/scripts/hfs/pin-findings.mjs';
import { CHECK_ENVS, checkEnvOf, judgedForEnv, localOnlyCodes, localReported, localVerdictLine, type EnvFinding } from '../runtime/scripts/hfs/check-env.mjs';
import type { CacheRecord } from '../cache/types.mjs';

type Build = { readonly version: string; readonly source?: string; readonly registry: 'npm' | 'local' };

const lockEntry = (name: string, build: Build): object => ({
  version: build.version,
  integrity: `sha512-${hashText(`${name}@${build.version}`)}`,
  resolved: build.registry === 'npm' ? `https://registry.npmjs.org/${name}/-/x-${build.version}.tgz` : `http://127.0.0.1:4873/${name}/-/x-${build.version}.tgz`,
});

/** An app with the given packages installed: each in its `node_modules` with the manifest the build packed, and in the lockfile. */
function app(t: { after(fn: () => void): void }, builds: Record<string, Build>): { root: string; hfsDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-env-source-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packages: Record<string, object> = { '': { name: 'demo' } };
  for (const [name, build] of Object.entries(builds)) {
    const dir = path.join(root, 'node_modules', ...name.split('/'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: build.version, ...(build.source === undefined ? {} : { [SOURCE_FIELD]: build.source }) }));
    packages[`node_modules/${name}`] = lockEntry(name, build);
  }
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages }));
  return { root, hfsDir: path.join(root, 'node_modules', '@starci', 'hfs') };
}

const printed = (given: { root: string; hfsDir: string }) => computeFingerprint({ root: given.root, tracked: [], hfsDir: given.hfsDir });
const SOURCE = 'a'.repeat(64);
const NPM = (source: string | null = SOURCE): Record<string, Build> => ({
  '@starci/hfs': { version: '6.2.2', registry: 'npm', ...(source === null ? {} : { source }) },
  '@starci/eslint-canon-be': { version: '3.19.4', registry: 'npm', ...(source === null ? {} : { source: `${source}b` }) },
  '@starci/jest-preset': { version: '2.8.0', registry: 'npm', ...(source === null ? {} : { source: `${source}c` }) },
});
const LOCAL = (source: string | null = SOURCE): Record<string, Build> => Object.fromEntries(Object.entries(NPM(source)).map(([name, build]) => [name, { ...build, version: `${build.version}-local.3`, registry: 'local' as const }]));

test('the local-registry build and the npm build of one source yield identical fingerprints and keys, and the local build is portable', (t) => {
  const npm = app(t, NPM());
  const local = app(t, LOCAL());
  const fromNpm = printed(npm);
  const fromLocal = printed(local);
  assert.equal(fromLocal.portable, true, 'a local-registry install that carries a source digest is portable');
  assert.deepEqual(fromLocal.localReasons.filter((reason) => !reason.includes('runs from a local folder')), []);
  assert.deepEqual(fromLocal.parts, fromNpm.parts);
  const reads = { packages: ['node_modules/@starci/eslint-canon-be', 'node_modules/@starci/jest-preset'], files: [] };
  assert.equal(keyWithReads('base', reads, readsContext(local.root, () => undefined)), keyWithReads('base', reads, readsContext(npm.root, () => undefined)));
});

test('a source change yields different fingerprints and keys in either build', (t) => {
  const before = app(t, LOCAL(SOURCE));
  const after = app(t, LOCAL('c'.repeat(64)));
  const changed = fingerprintDifferences(printed(before).parts, printed(after).parts);
  assert.ok(changed.includes('hfs'));
  assert.ok(changed.includes('pkg:@starci/eslint-canon-be'));
  assert.ok(changed.includes('pkg:@starci/jest-preset'));
  const reads = { packages: ['node_modules/@starci/jest-preset'], files: [] };
  assert.notEqual(keyWithReads('base', reads, readsContext(before.root, () => undefined)), keyWithReads('base', reads, readsContext(after.root, () => undefined)));
  const npmAfter = app(t, NPM('c'.repeat(64)));
  assert.notEqual(keyWithReads('base', reads, readsContext(before.root, () => undefined)), keyWithReads('base', reads, readsContext(npmAfter.root, () => undefined)));
});

test('a local-registry install without a source digest (an old build) has no portable fingerprint, and the reason is the local registry alone', (t) => {
  const old = printed(app(t, LOCAL(null)));
  assert.equal(old.portable, false);
  assert.match(old.localReasons.join('\n'), /registry on this machine and carries no source digest/u);
  assert.equal(old.localRegistry, true);
  const published = printed(app(t, NPM(null)));
  assert.equal(published.portable, true, 'an npm install without a digest is keyed by version and integrity, as before');
  assert.notDeepEqual(published.parts, printed(app(t, NPM())).parts, 'a digest-less and a stamped build of one version are keyed apart');
});

function seeded(t: { after(fn: () => void): void }): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-env-session-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'a.ts'), 'x\n');
  git(root, ['init', '-q', '-b', 'main']);
  return root;
}

const record = (): CacheRecord => ({ path: 'a.ts', step: 'prettier', hash: hashText('x\n'), findings: [] });

test('records a run on the local build wrote are reused warm after the restore to the npm build, and CI trusts them', (t) => {
  const local = printed(app(t, LOCAL()));
  const restored = printed(app(t, NPM()));
  assert.equal(differencesByFamily(fingerprintDifferences(local.parts, restored.parts)).size, 0);
  const root = seeded(t);
  const options = (fingerprint: { parts: typeof local.parts; portable: boolean; localReasons: readonly string[] }, extra: object = {}) => ({ root, tracked: ['a.ts'], env: {}, progress: silentProgress, fingerprint, journalRoot: false as const, ...extra });
  const portable = { ...local, portable: true, localReasons: [] as string[] };
  const first = createDiskSession(options(portable));
  first.replace('check/format', [record()], { depth: 3 });
  assert.equal(first.writes, true);
  first.flush();
  const warm = createDiskSession(options({ ...restored, portable: true, localReasons: [] }));
  for (const family of ['hfs', 'format', 'lint', 'test', 'types'] as const) assert.equal(warm.decide(family).mode, 'diff', `${family} reuses the records after the restore`);
  assert.equal(warm.records('check/format').length, 1);
  const files = readCacheDir(root);
  const trust = { kind: 'base' as const, reason: 'the cache at abc', base: 'abc', files: (): ReadonlyMap<string, string> => files };
  const ci = createDiskSession(options({ ...restored, portable: true, localReasons: [] }, { trust, env: { CI: 'true' } }));
  assert.equal(ci.decide('format').mode, 'diff', 'CI trusts the records of the local run');
  assert.equal(ci.records('check/format').length, 1);
  const rebuilt = createDiskSession(options({ ...printed(app(t, NPM('d'.repeat(64)))), portable: true, localReasons: [] }, { trust, env: { CI: 'true' } }));
  assert.equal(rebuilt.decide('hfs').mode, 'full', 'a source change reruns the families that read the package');
  assert.equal(rebuilt.decide('format').mode, 'diff', 'and no other');
});

const EXPECTED_LOCAL_ONLY = ['HFS_CANON_PIN_DRIFT', 'HFS_CHECK_CACHE_UNPORTABLE'];

test('the local-only finding set is the one list of failure-codes.yaml', () => {
  assert.deepEqual([...localOnlyCodes()].sort(), EXPECTED_LOCAL_ONLY);
  assert.deepEqual(CHECK_ENVS, ['local', 'prod']);
  assert.equal(checkEnvOf(undefined), 'local', 'local is the default');
  assert.equal(checkEnvOf('prod'), 'prod');
  assert.equal(checkEnvOf('staging'), undefined);
});

const pins = { '@starci/grammar': { version: '0.25.1', group: 'starci', side: 'fe', source: 'x' } } as unknown as Parameters<typeof pinFindings>[0]['pins'];

/** The findings of a package.json pinning grammar at `spec`, whose lockfile locked grammar at `locked` when given. */
function pinned(t: { after(fn: () => void): void }, spec: string, locked?: { version: string; resolved: string }): ReturnType<typeof pinFindings> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-env-pins-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { '@starci/grammar': spec } }));
  if (locked !== undefined) fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/@starci/grammar': locked } }));
  return pinFindings({ repoRoot: root, files: ['package.json'], profile: 'fe', pins });
}

test('local tolerates exactly the listed local findings, prod blocks them, and a code error is red in both', (t) => {
  const drift = pinned(t, '0.25.2', { version: '0.25.2', resolved: 'http://127.0.0.1:4873/@starci/grammar/-/grammar-0.25.2.tgz' });
  const wrong = pinned(t, '^0.25.0', { version: '0.25.0', resolved: 'http://127.0.0.1:4873/@starci/grammar/-/grammar-0.25.0.tgz' });
  const published = pinned(t, '0.25.2', { version: '0.25.2', resolved: 'https://registry.npmjs.org/@starci/grammar/-/grammar-0.25.2.tgz' });
  assert.equal(drift.length, 1);
  assert.equal(drift[0]?.local, true, 'a pin the lockfile resolved from the local registry is caused by the local loop alone');
  assert.equal(wrong[0]?.local, undefined, 'a range pin is a real drift');
  assert.equal(published[0]?.local, undefined, 'the same version resolved from npm is a real drift');
  const unportable = freshnessFindings({ root: os.tmpdir(), portable: false, localReasons: ['@starci/x is installed from a registry on this machine and carries no source digest (starci deps install-local)'], localRegistry: true, written: [], removed: [], uncommitted: [] });
  assert.equal(unportable[0]?.code, UNPORTABLE);
  assert.equal(unportable[0]?.local, true);
  const linked = freshnessFindings({ root: os.tmpdir(), portable: false, localReasons: ['@starci/x is linked'], localRegistry: false, written: [], removed: [], uncommitted: [] });
  assert.equal(linked[0]?.local, undefined, 'a linked folder is not the registry loop');
  const lint: EnvFinding = { code: 'LINT_NEW_CODE_FINDING', level: 'error', local: true };
  const types: EnvFinding = { code: 'TS2322', level: 'error' };
  const suite: EnvFinding = { code: 'CI_PARITY_STEP_FAILED', level: 'error' };
  const all: EnvFinding[] = [...drift, ...wrong, ...unportable, ...linked, lint, types, suite];
  const local = judgedForEnv(all, 'local');
  const reported = (finding: EnvFinding): boolean => finding.report === true;
  assert.deepEqual(local.filter(reported).map((finding) => finding.code), [drift[0]?.code, unportable[0]?.code]);
  assert.deepEqual(localReported(local).length, 2);
  assert.equal(local.filter((finding) => finding.level === 'error' && !reported(finding)).length, all.length - 2, 'wrong pins, linked folders, lint, types and test errors stay red');
  assert.equal(judgedForEnv([lint], 'local')[0]?.report, undefined, 'a code outside the list is never softened, whatever it carries');
  assert.equal(judgedForEnv(all, 'prod').filter(reported).length, 0, 'prod blocks every finding');
  assert.match(localVerdictLine(localReported(local)) ?? '', /^gate: green for local \(not pushable\), 2 local finding\(s\) report-only/u);
  assert.equal(localVerdictLine([]), null);
});

test('the managed hook, the CI templates and the release gate judge as prod', () => {
  const templates = new URL('../templates/app/', import.meta.url);
  const read = (file: string): string => fs.readFileSync(new URL(file, templates), 'utf8');
  assert.match(read('hooks/husky/pre-push'), /^node node_modules\/starci-harness\/dist\/main\.js app check --env prod$/mu);
  for (const flavour of ['ci-workflows', 'ci-workflows-lite']) {
    const verify = read(`${flavour}/github/workflows/cache-verify.yml`);
    assert.match(verify, /starci app check --env prod --fresh \$\{\{ matrix\.args \}\}$/mu, 'every shard of the verify judges as prod');
    const ci = read(`${flavour}/github/workflows/ci.yml`);
    const runs = ci.split('\n').filter((line) => /starci app check\b/u.test(line) && !line.trimStart().startsWith('#'));
    assert.ok(runs.length > 0);
    for (const line of runs) assert.match(line, /--env prod$/u, line);
  }
  assert.deepEqual(APP_CHECK_COMMAND.slice(-2), ['--env', 'prod']);
});
