// The two-level gate (owner 2026-11-22: "rules là k check nhánh khi dev, khi nào push mới check tổng 1 lần sửa 1 lần vẫn hơn"): `app check --level dev` is the FAST
// level of a landing on dev and runs exactly its gates (types with its builds and codegen, the lane's own tests, db), names what it skips and
// that it runs at the main cut; `--level full` (the default) is every gate. The managed pre-push hook routes a push of dev or a lane branch to the fast level and
// everything else (main, a release tag, another branch) to the full one.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from './main.mjs';
import type { FamilyId } from '../cache/types.mjs';
import { CHECK_LEVELS, checkLevelOf, FAST_FAMILIES, FAST_SKIPPED, fastLevelLine, laneSpecs, runLaneTests } from '../cache/fast-level.mjs';
import type { JestEnvironment } from '../cache/test-family.mjs';
import { push, ref, repository, ZERO } from './helpers/pre-push-fixture.mjs';
import { APP_CHECK_COMMAND } from '../release/gate.mjs';

const PROBE = 'the fast level reached the HFS boundary';

async function probe(t: TestContext, argv: string[]) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-fast-level-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const calls: FamilyId[][] = [];
  let err = '';
  const code = await main(['check', ...argv], {
    cwd: root, env: { STARCI_CACHE_HOME: path.join(root, 'tool-cache') }, stdout: () => {}, stderr: (text) => { err += text; },
    checkApp: ({ selected }: { selected: Set<FamilyId> }) => { calls.push([...selected]); throw new Error(PROBE); },
  });
  return { code, err, calls };
}

test('the fast level runs exactly its gates and names, first, every gate it skips and that they run at the main cut', async (t) => {
  assert.deepEqual(CHECK_LEVELS, ['full', 'dev']);
  assert.equal(checkLevelOf(undefined), 'full', 'no --level is the full level');
  assert.equal(checkLevelOf('fast'), undefined);
  const fast = await probe(t, ['--level', 'dev', '--env', 'prod']);
  assert.deepEqual(fast.calls, [[...FAST_FAMILIES]]);
  assert.deepEqual([...FAST_FAMILIES].sort(), ['db', 'test', 'types']);
  const first = fast.err.split('\n')[0] ?? '';
  assert.equal(first, fastLevelLine(), 'the skip line is the first thing the run prints');
  for (const skipped of FAST_SKIPPED) assert.ok(first.includes(skipped), skipped);
  assert.match(first, /hfs rule sweep/u);
  assert.match(first, /rule-188 first audits and the ui-audit stale and missing blocks/u);
  assert.match(first, /nivoos package checks/u);
  assert.match(first, /whole-repo tests and coverage/u);
  assert.match(first, /sonar/u);
  assert.doesNotMatch(first, /design approval/u, 'the owner approval is no gate');
  assert.match(first, /run once at the main cut \(app check --level full\)/u);
});

test('the full level is the default and runs every family; the fast level refuses the flags that would change its gates', async (t) => {
  const full = await probe(t, ['--level', 'full']);
  assert.ok((full.calls[0] ?? []).includes('hfs') && (full.calls[0] ?? []).includes('uiaudit') && (full.calls[0] ?? []).includes('build'), 'full: the rule sweep, the ui audit and the CI parity families');
  assert.doesNotMatch(full.err, /--level dev \(fast\)/u);
  const plain = await probe(t, []);
  assert.deepEqual(plain.calls, full.calls, 'no --level is --level full');
  for (const flags of [['--gate', 'hfs'], ['--side', 'be'], ['--coverage-from', 'x.lcov']]) {
    const refused = await probe(t, ['--level', 'dev', ...flags]);
    assert.equal(refused.code, 2, flags.join(' '));
    assert.match(refused.err, /--level dev runs exactly the fast gates/u);
    assert.deepEqual(refused.calls, []);
  }
  assert.equal((await probe(t, ['--level', 'quick'])).code, 2);
});

const fakeJest = (closures: Record<string, string[]>, passing: readonly string[]): JestEnvironment & { ran: string[][] } => {
  const ran: string[][] = [];
  return {
    ran,
    specs: Object.keys(closures),
    configHash: 'h',
    closureOf: (spec) => closures[spec] ?? [],
    run: (specs, dir) => {
      ran.push([...specs]);
      for (const spec of specs) fs.writeFileSync(path.join(dir, `${path.basename(spec)}.json`), JSON.stringify({ spec: spec.replace(/^be\//u, ''), passed: passing.includes(spec), loaded: [], sources: {} }));
      return { status: specs.every((spec) => passing.includes(spec)) ? 0 : 1, output: '' };
    },
    readCoverage: (dir) => fs.readdirSync(dir).map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))),
  };
};

test("the lane's own tests: the specs its diff touches and the specs whose closure reaches a changed file, nothing else", async () => {
  const closures = { 'be/src/a.spec.ts': ['be/src/a.ts', 'be/src/shared.ts'], 'be/src/b.spec.ts': ['be/src/b.ts'], 'be/src/c.spec.ts': ['be/src/c.ts', 'be/src/shared.ts'] };
  assert.deepEqual(laneSpecs({ specs: Object.keys(closures), closureOf: (spec) => closures[spec as keyof typeof closures] }, ['be/src/b.spec.ts']), ['be/src/b.spec.ts'], 'a touched spec');
  assert.deepEqual(laneSpecs({ specs: Object.keys(closures), closureOf: (spec) => closures[spec as keyof typeof closures] }, ['be\\src\\shared.ts']), ['be/src/a.spec.ts', 'be/src/c.spec.ts'], 'the related specs of a changed module');
  assert.deepEqual(laneSpecs({ specs: Object.keys(closures), closureOf: () => [] }, []), [], 'no diff, no spec');
  const jest = fakeJest(closures, ['be/src/a.spec.ts']);
  const lane = await runLaneTests({ repoRoot: os.tmpdir(), tracked: [], changed: ['be/src/shared.ts'], jest });
  assert.deepEqual(jest.ran, [['be/src/a.spec.ts', 'be/src/c.spec.ts']], 'one run of the related specs alone, never the whole suite');
  assert.deepEqual(lane.failed, ['be/src/c.spec.ts']);
  assert.deepEqual(lane.findings.map((finding) => [finding.code, finding.path]), [['JEST_SPEC_FAILED', 'be/src/c.spec.ts']]);
  assert.match(lane.lines[0] ?? '', /ran 2 of 3 unit spec\(s\)/u);
  const none = await runLaneTests({ repoRoot: os.tmpdir(), tracked: [], changed: ['fe/app/page.tsx'], jest: fakeJest(closures, []) });
  assert.deepEqual(none.findings, []);
  assert.match(none.lines[0] ?? '', /none of 3 unit spec/u);
});

test('the pre-push hook runs the fast level once for a push of dev or a lane branch, and the full level for main, a release tag or another branch', (t) => {
  const hook = fs.readFileSync(new URL('../templates/app/hooks/husky/pre-push', import.meta.url), 'utf8').split('\n').slice(1).join('\n');
  assert.match(hook, /^  node node_modules\/starci-harness\/dist\/main\.js app check --env prod --level dev --push-refs "\$refs"$/mu);
  assert.match(hook, /^STARCI_PUSH_GATE=1 node node_modules\/starci-harness\/dist\/main\.js app check --env prod --level full$/mu);
  const repo = repository(t, hook);
  for (const lines of [[ref('refs/heads/dev', repo.head, ZERO)], [ref('refs/heads/lane/x', repo.head, ZERO)], [ref('refs/heads/lane/x', repo.head, ZERO), ref('refs/heads/dev', repo.head, ZERO)]]) {
    const run = push(repo, lines);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /^app check level dev, push refs: .*refs\/heads\/(dev|lane\/x)/mu, lines.map((line) => line[2]).join(' '));
    assert.doesNotMatch(run.stdout, /app check judged branch/u, 'one check pass: the full level does not run too');
  }
  for (const lines of [[ref('refs/heads/main', repo.head, ZERO), ref('refs/heads/dev', repo.head, ZERO)], [ref('refs/heads/feature/y', repo.head, ZERO)], [ref('refs/heads/lane/x', repo.head, ZERO), ref('refs/heads/feature/y', repo.head, ZERO)]]) {
    const run = push(repo, lines);
    assert.doesNotMatch(run.stdout, /app check level dev/u, lines.map((line) => line[2]).join(' '));
    if (run.status === 0) assert.match(run.stdout, /app check judged branch: .*level full/u);
  }
});

test('the release gate (app release, release cut and release push judge through it or the main hook) runs the full level', () => {
  const at = APP_CHECK_COMMAND.indexOf('--level');
  assert.equal(checkLevelOf(at === -1 ? undefined : APP_CHECK_COMMAND[at + 1]), 'full');
  assert.deepEqual(APP_CHECK_COMMAND.slice(0, 6), ['npx', 'starci', 'app', 'check', '--env', 'prod']);
});
