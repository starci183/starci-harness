// proves: HFS_GATE_DECLARATION_INVALID@lite
// proves: HFS_GATE_DECLARATION_INVALID@full
// The gates an app switches off for the whole app (`gates` of .starcistacks/application-stacks.yaml, PROJECT-LINT-4): the reader refuses hfs, secrets and db, an id that is
// no gate, a missing reason and a gate whose reader stays on; the one reader (activeProfile) folds the declaration into every gate's mode on every branch, the default branch
// included; the managed hooks, the rendered CI and the release gate follow it, and every one reports an off gate as `off (declared: <reason>)`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { main } from './main.mjs';
import { activeProfile, familyModes, profileNotices } from '../runtime/scripts/hfs/branch-profile.mjs';
import { checkRepo } from '../runtime/scripts/hfs/check.mjs';
import { HFS_GATES, OPTIONAL_GATES, PROFILE_GATES, idleJobs, optionalGatePolicy, readGateDeclarations } from '../runtime/scripts/lib/stack-declaration.mjs';
import { bypassesIn, MANAGED_CI as CI } from '../runtime/scripts/lib/bypass-markers.mjs';
import { bypassMarkerFindings } from '../runtime/scripts/hfs/rules/bypass-markers.mjs';
import { ciStandardFindings } from '../runtime/scripts/hfs/rules/ci-standard.mjs';
import { pipelineFindings } from '../runtime/scripts/hfs/rules/pipeline.mjs';
import { supplyChainFindings } from '../runtime/scripts/hfs/rules/supply-chain.mjs';
import { ciCustodyFindings } from '../runtime/scripts/hfs/rules/ci-custody.mjs';
import { judge as hygieneJudge } from '../sync/hygiene.mjs';
import { spawnSync } from 'node:child_process';
import { ciWorkflowCommands, offStep, verifyShards } from '../sync/ci-commands.mjs';
import { offRows } from '../release/gate.mjs';
import { parseWorkflow } from '../runtime/scripts/hfs/runtime-rules/workflow-source.mjs';
import { renderTargets } from '../sync/index.mjs';
import { APP, PRESETS } from './helpers/hfs-cli-fixture.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';
import { push, ref, repository, ZERO } from './helpers/pre-push-fixture.mjs';

// reason: a rendered workflow is parsed data the cases read freely
type Doc = any;

const REASON = 'the product model is not settled; quality and test investment is deferred';
const ALL_OFF = [...OPTIONAL_GATES].map((gate) => `  ${gate}: { run: off, reason: "${REASON}" }`).join('\n');
const declaration = (gates: string): string => ['schema: starci/application-stacks@1', 'services:', '  sonar:', '    provider: sonarqube', '    mode: local', '    stack:', '      owner: host', '      root: .claude/ext/sonar', gates === '' ? '' : `gates:\n${gates}`].join('\n');
const doc = (gates: Record<string, unknown>): Record<string, unknown> => ({ schema: 'starci/application-stacks@1', gates });
const off = (...ids: string[]): Record<string, unknown> => Object.fromEntries(ids.map((id) => [id, { run: 'off', reason: REASON }]));

function app(t: import('node:test').TestContext, gates: string): string {
  const root = mkdtemp(t, 'starci-gates-');
  fs.mkdirSync(path.join(root, '.starcistacks', 'dev'), { recursive: true });
  fs.writeFileSync(path.join(root, '.starcistacks', 'application-stacks.yaml'), declaration(gates));
  fs.writeFileSync(path.join(root, '.starcistacks', 'dev', 'environment.json'), '{}');
  return root;
}

test('the closed set: hfs, secrets and db are never switchable, every other gate is', () => {
  assert.deepEqual([...HFS_GATES].sort(), ['db', 'hfs', 'secrets']);
  assert.deepEqual([...OPTIONAL_GATES].sort(), PROFILE_GATES.filter((gate) => !HFS_GATES.has(gate)).sort());
  assert.deepEqual([...OPTIONAL_GATES].sort(), ['audit', 'build', 'checks', 'codecov', 'coverage', 'deps', 'format', 'lint', 'sonar', 'test', 'types', 'wiring']);
  assert.deepEqual([...optionalGatePolicy({})].sort(), [...OPTIONAL_GATES].sort(), 'a run outside the CLI takes the whole set');
  assert.deepEqual([...optionalGatePolicy({ STARCI_OPTIONAL_GATES: 'lint,hfs,secrets' })], ['lint'], 'the policy never widens past the optional gates');
});

test('HFS_GATE_DECLARATION_INVALID: the reader keeps a sound declaration and refuses hfs, secrets, db, an unknown id, a missing reason, a wrong run and a reader left on', () => {
  const sound = readGateDeclarations(doc(off(...OPTIONAL_GATES)));
  assert.deepEqual(sound.problems, []);
  assert.equal(Object.keys(sound.off).length, OPTIONAL_GATES.size);
  assert.equal(sound.off.lint, REASON);
  assert.deepEqual(readGateDeclarations({ schema: 'x' }), { off: {}, problems: [] }, 'nothing declared: every gate runs');
  for (const gate of ['hfs', 'secrets', 'db']) {
    const refused = readGateDeclarations(doc(off('lint', gate)));
    assert.deepEqual(refused.off, {}, `${gate}: a refused block switches nothing off`);
    assert.match(refused.problems[0]?.message ?? '', new RegExp(`${gate} is never switched off: it blocks in every app`, 'u'));
  }
  assert.match(readGateDeclarations(doc(off('nope'))).problems[0]?.message ?? '', /nope is not a gate/u);
  assert.match(readGateDeclarations(doc({ lint: { run: 'off' } })).problems[0]?.message ?? '', /lint is switched off with no reason/u);
  assert.match(readGateDeclarations(doc({ lint: { run: 'off', reason: '  ' } })).problems[0]?.message ?? '', /no reason/u);
  assert.match(readGateDeclarations(doc({ lint: { run: 'on', reason: 'x' } })).problems[0]?.message ?? '', /the only value is off/u);
  assert.match(readGateDeclarations(doc({ lint: { run: 'off', reason: 'x', more: 1 } })).problems[0]?.message ?? '', /\{ run: off, reason/u);
  assert.match(readGateDeclarations({ gates: 'lint' }).problems[0]?.message ?? '', /mapping of gate id/u);
  assert.match(readGateDeclarations(doc(off('test'))).problems.map((problem) => problem.message).join('\n'), /test is switched off but coverage, codecov, sonar read its output/u);
  assert.match(readGateDeclarations(doc(off('lint'))).problems[0]?.message ?? '', /sonar reads its output/u);
  assert.deepEqual(readGateDeclarations(doc(off('lint', 'sonar'))).problems, []);
  assert.match(readGateDeclarations(doc(off('format')), new Set(['lint'] as const)).problems[0]?.message ?? '', /format may not be switched off: policy\/loosening\.yaml optionalGates allows lint/u);
});

test('HFS_GATE_DECLARATION_INVALID: the app check names a refused declaration as an error finding and accepts a sound one', (t) => {
  for (const [gates, refused] of [[ALL_OFF, 0], ['  hfs: { run: off, reason: "x" }', 1], ['  lint: { run: off }', 1]] as const) {
    const root = app(t, gates);
    const report = checkRepo({ repoRoot: root, declaration: { hfs: 3, kind: 'app', project: 'fixture', edition: 'full', sides: { be: { apps: [{ name: 'core', kind: 'api' }] }, fe: { apps: [{ name: 'web', kind: 'next' }] } } }, files: ['.starcistacks/application-stacks.yaml', '.starcistacks/dev/environment.json'], tree: false });
    const found = report.findings.filter((finding) => finding.code === 'HFS_GATE_DECLARATION_INVALID');
    assert.equal(found.length, refused, gates);
    for (const finding of found) assert.equal(finding.level, 'error');
  }
});

test('one reader: a declared gate is off on every branch, the default branch and a release push included, a refused block lowers nothing, and an app that declares nothing runs every gate', (t) => {
  const root = app(t, ALL_OFF);
  for (const env of [{}, { STARCI_JUDGED_BRANCH: 'main' }, { GITHUB_BASE_REF: 'main', GITHUB_HEAD_REF: 'dev' }, { GITHUB_REF: 'refs/heads/main' }]) {
    const profile = activeProfile(root, env);
    for (const gate of OPTIONAL_GATES) assert.equal(profile.modes[gate], 'off', `${gate} ${JSON.stringify(env)}`);
    for (const gate of HFS_GATES) assert.equal(profile.modes[gate], 'blocking', `${gate} keeps blocking`);
    assert.equal(familyModes(profile).lint, 'off');
    assert.equal(profile.declaredOff.test, REASON);
  }
  const notices = profileNotices(activeProfile(root, { STARCI_JUDGED_BRANCH: 'main' }));
  assert.equal(notices.length, OPTIONAL_GATES.size, 'every off gate is reported, never silently absent');
  assert.ok(notices.every((notice) => /^[a-z]+: off \(declared: the product model is not settled; quality and test investment is deferred\), not run and not counted as passed/u.test(notice)));
  const refused = activeProfile(app(t, '  hfs: { run: off, reason: "x" }\n  lint: { run: off, reason: "x" }'), {});
  assert.deepEqual([refused.declaredOff, refused.modes.lint], [{}, 'blocking']);
  const none = activeProfile(app(t, ''), {});
  assert.deepEqual([none.declaredOff, ...PROFILE_GATES.map((gate) => none.modes[gate])].flat().filter((mode) => mode !== 'blocking' && typeof mode === 'string'), []);
  assert.deepEqual(profileNotices(none), []);
});

test('app check --profile lists an off gate as off (declared: <reason>); one --gate prints the word the hooks read', async (t) => {
  const root = app(t, ALL_OFF);
  const run = async (argv: string[]): Promise<string> => {
    let stdout = '';
    await main(['check', ...argv], { cwd: root, env: { PATH: process.env.PATH }, stdout: (text: string) => { stdout += text; }, stderr: () => undefined });
    return stdout;
  };
  assert.equal(await run(['--profile', '--gate', 'lint']), 'off\n');
  assert.equal(await run(['--profile', '--gate', 'format']), 'off\n');
  assert.equal(await run(['--profile', '--gate', 'deps']), 'off\n');
  assert.equal(await run(['--profile', '--gate', 'hfs']), 'blocking\n');
  const listing = await run(['--profile']);
  assert.match(listing, new RegExp(`  lint off \\(declared: ${REASON}\\)\\n`, 'u'));
  assert.match(listing, /  hfs blocking\n/u);
  assert.equal(await run(['--profile', '--gate', 'nope']).catch(() => 'refused'), '', 'an unknown gate is a usage error');
});

test('CI: a declared-off gate renders as one echo line that says so, a job whose whole gate is off is skipped and the verdict expects it idle, in both editions', () => {
  const read = (yaml: string) => (file: string): string => { if (file === '../.starcistacks/application-stacks.yaml') return yaml; throw Object.assign(new Error('absent'), { code: 'ENOENT' }); };
  const none = ciWorkflowCommands({ files: [], read: read(declaration('')) });
  assert.equal(none['ciFormatRun'], 'npx --no-install starci app check --gate format --env prod');
  assert.equal(none['ciTypecheckRun'], 'npm run typecheck');
  assert.deepEqual([none['offLint'], none['offTest'], none['coverageIf'], none['verdictIdle'], none['planGatesOff']], ['', '', '', '', '']);
  assert.equal(none['verdictJobs'], 'fast lint test coverage build');
  const all = ciWorkflowCommands({ files: [], read: read(declaration(ALL_OFF)) });
  for (const key of ['ciFormatRun', 'ciWiringRun', 'ciTypecheckRun', 'ciTestRun', 'ciBuildBeRun', 'auditCommand', 'ciCoverageProof']) assert.match(all[key] ?? '', new RegExp(`^"echo '[a-z]+: off \\(declared: ${REASON}\\)'"$`, 'u'), key);
  assert.equal(all['verdictJobs'], 'fast build');
  assert.equal(all['verdictIdle'], '\n          expect lint idle\n          expect test idle\n          expect coverage idle');
  assert.equal(all['sonarJob'], '', 'no Sonar job is rendered');
  assert.equal(all['verdictSonarNeed'], '');
  assert.match(all['codecovSteps'] ?? '', /codecov disabled/u);
  assert.match(all['ciLintSteps'] ?? '', /off \(declared:/u);
  assert.equal(verifyShards(['be'], { lint: 'x', test: 'x', types: 'x' }).includes('--gate lint'), false);
  assert.equal(verifyShards(['be'], { test: 'x' }).includes('--gate test'), false);
  assert.ok(verifyShards(['be'], {}).includes('--gate hfs') && verifyShards(['be'], {}).includes('--gate lint --side be'));
  assert.equal(JSON.parse(offStep('lint', "it's \"odd\": x")), "echo 'lint: off (declared: it'\\''s \"odd\": x)'");
  for (const edition of ['full', 'lite']) {
    const source = { files: [], read: read(declaration(ALL_OFF)), stack: { images: [], passEnv: [], imageEnvironments: {}, environments: [], imageCache: 'gha' }, hasImage: () => true } as unknown as NonNullable<NonNullable<Parameters<typeof renderTargets>[2]>['source']>;
    const text = renderTargets({ ...structuredClone(APP), edition }, PRESETS, { source }).find((target) => target.path === '.github/workflows/ci.yml')?.content ?? '';
    const ci: Doc = parseWorkflow(text);
    assert.equal(ci.jobs.lint.if, "${{ needs.plan.outputs.checks == 'true' && false }}", edition);
    assert.equal(ci.jobs.test.if, "${{ needs.plan.outputs.checks == 'true' && false }}");
    assert.equal(ci.jobs.coverage.if, '${{ false }}');
    assert.equal(ci.jobs.sonar, undefined);
    const steps = (job: string): string => JSON.stringify(ci.jobs[job].steps);
    assert.match(steps('fast'), /format: off \(declared:/u);
    assert.match(steps('fast'), /types: off \(declared:/u);
    assert.match(steps('fast'), /audit: off \(declared:/u);
    assert.match(ci.jobs.verdict.steps[0].run, /expect lint idle/u);
    assert.match(ci.jobs.plan.steps.find((step: Doc) => step.id === 'plan').run, /gate lint: off \(declared:/u);
  }
});

test('the release gate drops the rows of a declared-off gate and names them, but the build rows always run', (t) => {
  const root = app(t, ALL_OFF);
  const rows = offRows(root, {});
  for (const name of ['format-check', 'typecheck', 'lint', 'test', 'test-e2e', 'audit', 'sonar']) assert.equal(rows.dropped.get(name), REASON, name);
  for (const name of ['build-be', 'build-fe', 'db-lint', 'db-drift', 'app-check']) assert.equal(rows.dropped.has(name), false, `${name} still runs`);
  assert.ok(rows.lines.includes(`build: off (declared: ${REASON}), but a release builds the image: the build rows run`));
  assert.ok(rows.lines.includes(`lint: off (declared: ${REASON}), its rows do not run and are not counted as passed`));
  assert.equal(offRows(app(t, ''), {}).dropped.size, 0, 'nothing declared: every row runs');
});

test('the pre-push hook skips deps check for an app that declares it off, and always runs it on a push of main', (t) => {
  const hook = fs.readFileSync(new URL('../templates/app/hooks/husky/pre-push', import.meta.url), 'utf8').split('\n').slice(1).join('\n');
  const on = repository(t, hook, { depsExit: 1 });
  assert.equal(push(on, [ref('refs/heads/dev', on.head, ZERO)]).status, 1, 'the pin check blocks while the gate runs');
  const declared = repository(t, hook, { depsExit: 1, depsMode: 'off' });
  const dev = push(declared, [ref('refs/heads/dev', declared.head, ZERO)]);
  assert.equal(dev.status, 0, dev.stderr);
  assert.match(dev.stdout, /deps: off by declaration/u);
  const release = push(declared, [ref('refs/heads/main', declared.head, ZERO), ref('refs/heads/dev', declared.head, ZERO)]);
  assert.equal(release.status, 1, 'a push of main always runs the pin check');
});

test('every reader of a managed CI file reads the declaration: the render of a declared-off gate is compliant, the same file with nothing declared is refused', (t) => {
  const read = (yaml: string) => (file: string): string => { if (file === '../.starcistacks/application-stacks.yaml') return yaml; throw Object.assign(new Error('absent'), { code: 'ENOENT' }); };
  // With the build off nothing before the database step builds the root packages, so the step builds them; an app without fe renders no fe build step.
  const packagesApp = ciWorkflowCommands({ files: [], read: read(declaration(ALL_OFF)) }, undefined, undefined, { rootPackages: true, app: { declaredSides: ['be', 'packages'], sides: { fe: { apps: [] } } } as never });
  assert.match(packagesApp['ciDatabaseLint'] ?? '', /^npm run build:modules --silent && npm run db:lint/u);
  assert.equal(packagesApp['ciBuildSteps'], '');
  assert.equal(ciWorkflowCommands({ files: [], read: read(declaration('')) }, undefined, undefined, { rootPackages: true })['ciDatabaseLint'], 'npm run db:lint', 'an app with the build on builds the packages in the build step');
  const ciDeclaration = (gates: string): string => ['schema: starci/application-stacks@1', 'ci:', '  secrets:', '    - {name: SONAR_TOKEN, scope: repository, purpose: the Sonar analysis token}',
    '  vars:', '    - {name: SONAR_HOST_URL, scope: repository, value: "https://sonar.example.invalid", purpose: the Sonar host}', 'services:', '  sonar:', '    provider: sonarqube', '    mode: local',
    '    stack:', '      owner: host', '      root: .claude/ext/sonar', '    ci: {wiring: required, workflow: .github/workflows/ci.yml, token: SONAR_TOKEN, hostVar: SONAR_HOST_URL}', gates === '' ? '' : `gates:\n${gates}`].join('\n') + '\n';
  for (const edition of ['full', 'lite'] as const) {
    const source = { files: [], read: read(declaration(ALL_OFF)), stack: { images: [], passEnv: [], imageEnvironments: {}, environments: [], imageCache: 'gha' }, hasImage: () => true } as unknown as NonNullable<NonNullable<Parameters<typeof renderTargets>[2]>['source']>;
    const text = renderTargets({ ...structuredClone(APP), edition }, PRESETS, { source }).find((target) => target.path === '.github/workflows/ci.yml')?.content ?? '';
    const offAll = readGateDeclarations(doc(off(...OPTIONAL_GATES))).off;
    const gateItems = new Set(['job-shape', 'boot-proof', 'test-sharding', 'packages-built-first']);
    const items = (gates: typeof offAll): string[] => ciStandardFindings({ doc: parseWorkflow(text), file: CI, scope: 'app-ci', edition, rootPackages: false, off: gates }).map((finding: Doc) => finding.extra?.item ?? finding.item).filter((item: string) => gateItems.has(item));
    assert.deepEqual(items(offAll), [], `${edition}: the CI standard reads the declaration`);
    assert.ok(items({}).length > 0, `${edition}: the same file with nothing declared misses required steps`);
    assert.deepEqual(bypassesIn(CI, text, { idle: idleJobs(offAll) }), [], `${edition}: the idled jobs are the render, not a bypass`);
    assert.deepEqual(bypassesIn(CI, text).map((hit) => hit.label), ['a constant false condition', 'a constant false condition', 'a constant false condition'], `${edition}: undeclared, each idled job is a bypass (\`&& false\` included)`);
    assert.equal(bypassesIn('.github/workflows/other.yml', text, { idle: idleJobs(offAll) }).length, 3, 'only the managed ci.yml carries the render');
    const root = app(t, ALL_OFF);
    fs.writeFileSync(path.join(root, '.starcistacks', 'application-stacks.yaml'), ciDeclaration(ALL_OFF));
    fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(root, CI), text);
    const judged = (): string[] => [
      ...pipelineFindings({ repoRoot: root, files: [CI], pins: {} }),
      ...supplyChainFindings({ repoRoot: root, files: [CI], repo: { kind: 'app', edition } as never, isRoot: true, inScope: (file) => file === CI }).filter((finding: Doc) => finding.code === 'HFS_AUDIT_STEP_MISSING'),
      ...ciCustodyFindings({ repoRoot: root, repo: { kind: 'app', edition } as never, isRoot: true }).filter((finding: Doc) => finding.code === 'CI_DECLARATION_DRIFT'),
      ...bypassMarkerFindings({ repoRoot: root, files: [CI] }),
    ].map((finding: Doc) => finding.code).sort();
    assert.deepEqual(judged(), [], `${edition}: lint canon, audit step, CI declaration and bypass rules accept the render of the declaration`);
    // The pre-commit guard reads the staged declaration the commit records.
    const git = (...args: string[]) => spawnSync('git', ['-c', 'user.email=bench@example.invalid', '-c', 'user.name=bench', ...args], { cwd: root, encoding: 'utf8' });
    git('init', '-q');
    git('add', '-A');
    const staged = (): number => hygieneJudge(root, [CI]).findings.filter((finding) => finding.code === 'HFS_BYPASS_MARKER').length;
    assert.equal(staged(), 0, `${edition}: the staged render of the staged declaration passes the commit guard`);
    fs.writeFileSync(path.join(root, '.starcistacks', 'application-stacks.yaml'), ciDeclaration(''));
    git('add', '-A');
    assert.equal(staged(), 3, `${edition}: staged with nothing declared, each idled job is refused at the commit`);
    assert.deepEqual(judged(), ['CI_DECLARATION_DRIFT', 'CI_DECLARATION_DRIFT', 'HFS_AUDIT_STEP_MISSING', 'HFS_BYPASS_MARKER', 'HFS_BYPASS_MARKER', 'HFS_BYPASS_MARKER', 'HFS_CI_MISSING_CANON'], `${edition}: with nothing declared the same file is refused by each`);
  }
});
