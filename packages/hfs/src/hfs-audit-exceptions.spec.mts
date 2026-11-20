// R269 / PROJECT-LINT-5: the production audit is `starci app audit`, judged against the time-boxed, owner-approved exceptions of
// .starcistacks/security/audit-exceptions.yaml. One case per code, and the rules of exemption (every path under via, exact advisory and package, the level).
// proves: AUDIT_HIGH
// proves: AUDIT_EXCEPTION_INVALID
// proves: AUDIT_EXCEPTION_EXPIRED
// proves: AUDIT_EXCEPTION_TOO_LONG
// proves: AUDIT_EXCEPTION_FIX_AVAILABLE
// proves: AUDIT_EXCEPTION_UNUSED
// proves: AUDIT_EXCEPTION_ACTIVE
// proves: AUDIT_REPORT_UNREADABLE
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auditMain } from '../audit/cli.mjs';
import { judge, parseExceptions, rootsReaching } from '../audit/judge.mjs';
import type { AuditReport, Lockfile } from '../audit/judge.mjs';
import { parityStepsOf, familyOfStep } from '../cache/parity-family.mjs';
import { ciWorkflowCommands } from '../sync/ci-commands.mjs';
import { supplyChainFindings } from '../runtime/scripts/hfs/rules/supply-chain.mjs';
import { renderTargets } from '../sync/index.mjs';
import { APP, PRESETS } from './helpers/hfs-cli-fixture.mjs';
import { OR_TRUE } from './fixtures/loosening/swallows.mjs';

const NOW = new Date('2026-11-18T00:00:00Z');
const GHSA = 'GHSA-2222-3333-4444';
const OTHER_GHSA = 'GHSA-5555-6666-7777';

/** The root depends on `a` and `c`; `a` pulls in the vulnerable `bad`; `d` is a second direct dependency, with a path to `bad` only when `viaD`. */
function lock({ viaD = false, nested = false }: { viaD?: boolean; nested?: boolean } = {}): Lockfile {
  const bad = nested ? 'node_modules/a/node_modules/bad' : 'node_modules/bad';
  return { packages: {
    '': { dependencies: { a: '1', c: '1', ...(viaD ? { d: '1' } : {}) }, devDependencies: { dev: '1' } },
    'node_modules/a': { dependencies: { bad: '1' } },
    'node_modules/c': {},
    'node_modules/d': viaD ? { dependencies: { bad: '1' } } : {},
    'node_modules/dev': { dependencies: { bad: '1' } },
    [bad]: {},
  } };
}

const via = (severity = 'high', id = GHSA) => ({ source: 1, name: 'bad', title: 'a flaw', url: `https://github.com/advisories/${id}`, severity });
function report({ severity = 'high', id = GHSA, fix = false as unknown, nodes = ['node_modules/bad'] }: { severity?: string; id?: string; fix?: unknown; nodes?: string[] } = {}): AuditReport {
  return { vulnerabilities: {
    bad: { name: 'bad', severity, via: [via(severity, id)], fixAvailable: fix, nodes },
    a: { name: 'a', severity, via: ['bad'], fixAvailable: fix, nodes: ['node_modules/a'] },
  } };
}

const entry = (over: Record<string, string> = {}) => ({ advisory: GHSA, package: 'bad', via: '[a]', reason: 'no upstream fix yet', approvedBy: 'owner', approvedAt: '2026-11-17T00:00:00Z', expires: '2026-11-24T00:00:00Z', ...over });
const yaml = (...entries: Record<string, string>[]) => entries.map((each) => `- advisory: ${each['advisory']}\n  package: ${each['package']}\n  via: ${each['via']}\n  reason: ${JSON.stringify(each['reason'])}\n  approvedBy: ${each['approvedBy']}\n  approvedAt: ${each['approvedAt']}\n  expires: ${each['expires']}\n`).join('');

const run = (over: { report?: AuditReport; lock?: Lockfile | undefined; text?: string; level?: 'high' | 'moderate'; now?: Date } = {}) => judge({ report: over.report ?? report(), lock: 'lock' in over ? over.lock : lock(), exceptionsText: over.text, level: over.level ?? 'high', omitDev: true, now: over.now ?? NOW });
const errors = (findings: ReturnType<typeof run>) => findings.filter((finding) => finding.level === 'error').map((finding) => finding.code);

test('AUDIT_HIGH: a finding at the level with no exception fails, as npm audit failed it', () => {
  assert.deepEqual(errors(run()), ['AUDIT_HIGH']);
  assert.deepEqual(errors(run({ report: { vulnerabilities: {} } })), []);
});

test('an active exception exempts the finding and is printed as AUDIT_EXCEPTION_ACTIVE with its facts and days left', () => {
  const findings = run({ text: yaml(entry()) });
  assert.deepEqual(errors(findings), []);
  const active = findings.filter((finding) => finding.code === 'AUDIT_EXCEPTION_ACTIVE');
  assert.equal(active.length, 1);
  assert.equal(active[0]?.level, 'info');
  for (const part of [GHSA, 'bad', 'via a', 'no upstream fix yet', 'approved by owner', '2026-11-24T00:00:00Z', '6 day(s) left']) assert.ok(active[0]?.message.includes(part), part);
});

test('AUDIT_EXCEPTION_EXPIRED: expires at or before now is an error and exempts nothing', () => {
  for (const expires of ['2026-11-17T12:00:00Z', '2026-11-18T00:00:00Z']) {
    const codes = errors(run({ text: yaml(entry({ approvedAt: '2026-11-16T00:00:00Z', expires })) }));
    assert.deepEqual(codes.sort(), ['AUDIT_EXCEPTION_EXPIRED', 'AUDIT_HIGH']);
  }
});

test('AUDIT_EXCEPTION_TOO_LONG: more than 14 days from approvedAt to expires; exactly 14 is fine', () => {
  assert.deepEqual(errors(run({ text: yaml(entry({ expires: '2026-12-01T00:00:01Z' })) })).sort(), ['AUDIT_EXCEPTION_TOO_LONG', 'AUDIT_HIGH']);
  assert.deepEqual(errors(run({ text: yaml(entry({ expires: '2026-12-01T00:00:00Z' })) })), []);
});

test('AUDIT_EXCEPTION_FIX_AVAILABLE: a fix of the package itself (true, a non-major update, its own major) ends the exception', () => {
  for (const fix of [true, { name: 'a', version: '1.5.0', isSemVerMajor: false }, { name: 'bad', version: '5.0.0', isSemVerMajor: true }]) {
    assert.deepEqual(errors(run({ report: report({ fix }), text: yaml(entry()) })).sort(), ['AUDIT_EXCEPTION_FIX_AVAILABLE', 'AUDIT_HIGH']);
  }
});

test('a breaking change of another package is no fix: the exception stays active and its line says what npm offers', () => {
  const fix = { name: 'a', version: '0.9.0', isSemVerMajor: true };
  const findings = run({ report: report({ fix }), text: yaml(entry()) });
  assert.deepEqual(errors(findings), []);
  const active = findings.find((finding) => finding.code === 'AUDIT_EXCEPTION_ACTIVE');
  assert.match(active?.message ?? '', /breaking change of a to 0\.9\.0, not a fix of bad/u);
});

test('AUDIT_EXCEPTION_UNUSED: an exception with no matching finding is an error', () => {
  assert.deepEqual(errors(run({ report: { vulnerabilities: {} }, text: yaml(entry()) })), ['AUDIT_EXCEPTION_UNUSED']);
});

test('a finding below the declared level is ignored, and an exception for it is unused', () => {
  const moderate = report({ severity: 'moderate' });
  assert.deepEqual(run({ report: moderate }), []);
  assert.deepEqual(errors(run({ report: moderate, text: yaml(entry()) })), ['AUDIT_EXCEPTION_UNUSED']);
  assert.deepEqual(errors(run({ report: moderate, level: 'moderate' })), ['AUDIT_HIGH']);
});

test('the exact advisory and the exact package must match: another advisory or package is not exempt', () => {
  assert.deepEqual(errors(run({ text: yaml(entry({ advisory: OTHER_GHSA })) })).sort(), ['AUDIT_EXCEPTION_UNUSED', 'AUDIT_HIGH']);
  assert.deepEqual(errors(run({ text: yaml(entry({ package: 'a' })) })).sort(), ['AUDIT_EXCEPTION_UNUSED', 'AUDIT_HIGH']);
});

test('every path to the package must pass through a via package: one path that touches none is AUDIT_HIGH', () => {
  const both = { lock: lock({ viaD: true }) };
  assert.deepEqual(errors(run({ ...both, text: yaml(entry()) })), ['AUDIT_HIGH']);
  assert.deepEqual(errors(run({ ...both, text: yaml(entry({ via: '[a, d]' })) })), []);
  // A nested copy is reached through its requirer; a path through a dev dependency alone is no root of a production audit.
  assert.deepEqual(errors(run({ lock: lock({ nested: true }), report: report({ nodes: ['node_modules/a/node_modules/bad'] }), text: yaml(entry()) })), []);
  const bypass = run({ ...both, text: yaml(entry()) }).find((finding) => finding.code === 'AUDIT_HIGH');
  assert.match(bypass?.message ?? '', /passes through none of the exception's via packages \[from: d\]/u);
});

test('via names packages a path passes through, not only roots: deep routes from several roots and workspaces are exempt', () => {
  // The StarCi Next shape: apollo > graphql > tinyglobby > bad; a workspace ui > intl > watcher > bad; codegen > watcher.
  const deep: Lockfile = { packages: {
    '': { dependencies: { apollo: '1', codegen: '1' } },
    'node_modules/ui': { link: true, resolved: 'fe/packages/ui' },
    'fe/packages/ui': { name: 'ui', dependencies: { intl: '1' } },
    'node_modules/apollo': { dependencies: { graphql: '1' } },
    'node_modules/graphql': { dependencies: { tinyglobby: '1' } },
    'node_modules/tinyglobby': { dependencies: { bad: '1' } },
    'node_modules/intl': { dependencies: { watcher: '1' } },
    'node_modules/codegen': { dependencies: { watcher: '1' } },
    'node_modules/watcher': { dependencies: { bad: '1' } },
    'node_modules/bad': {},
  } };
  assert.deepEqual(errors(run({ lock: deep, text: yaml(entry({ via: '[graphql, watcher]' })) })), []);
  // Drop one route: the paths through watcher touch no via package any more.
  const high = run({ lock: deep, text: yaml(entry({ via: '[graphql]' })) }).filter((finding) => finding.code === 'AUDIT_HIGH');
  assert.equal(high.length, 1);
  assert.match(high[0]?.message ?? '', /\[from: codegen, intl\]/u);
  // The vulnerable package never counts as its own via.
  assert.deepEqual(errors(run({ lock: deep, text: yaml(entry({ via: '[bad]' })) })), ['AUDIT_HIGH']);
});

test('a path the lockfile cannot resolve is never exempt', () => {
  assert.deepEqual(errors(run({ lock: { packages: { '': {} } }, text: yaml(entry()) })), ['AUDIT_HIGH']);
  assert.deepEqual(errors(run({ lock: undefined, text: yaml(entry()) })), ['AUDIT_HIGH']);
  assert.deepEqual(errors(run({ report: report({ nodes: ['node_modules/nowhere'] }), text: yaml(entry()) })), ['AUDIT_HIGH']);
});

test('rootsReaching names the direct dependency each node comes from, workspaces included', () => {
  const reached = rootsReaching({ packages: {
    '': { dependencies: { a: '1' } }, 'be': { dependencies: { w: '1' } }, 'node_modules/be': { link: true, resolved: 'be' },
    'node_modules/a': { dependencies: { x: '1' } }, 'node_modules/w': { dependencies: { x: '1' } }, 'node_modules/x': {},
  } }, true);
  assert.deepEqual([...(reached.get('node_modules/x') ?? [])].sort(), ['a', 'w']);
  assert.equal(reached.has('node_modules/nothing'), false);
});

test('AUDIT_EXCEPTION_INVALID: a malformed file or entry is its own error', () => {
  const bad = [
    'not: a list', 'a: [', yaml(entry({ advisory: 'GHSA-*' })), yaml(entry({ advisory: 'GHSA-aaaa-bbbb-cccc' })), yaml(entry({ package: '*' })),
    yaml(entry({ via: '[]' })), yaml(entry({ reason: ' ' })), yaml(entry({ approvedBy: '""' })),
    yaml(entry({ expires: '2026-11-24' })), yaml(entry({ approvedAt: '2026-11-17T00:00:00' })), yaml(entry({ expires: '2026-13-40T00:00:00Z' })),
    `${yaml(entry())}  extra: 1\n`, '- just a string\n',
  ];
  for (const text of bad) {
    const parsed = parseExceptions(text);
    assert.deepEqual(parsed.findings.map((finding) => finding.code), ['AUDIT_EXCEPTION_INVALID'], text);
    assert.deepEqual(parsed.exceptions, []);
    assert.ok(errors(run({ text })).includes('AUDIT_EXCEPTION_INVALID'));
  }
  assert.deepEqual(parseExceptions(undefined), { exceptions: [], findings: [] });
  assert.deepEqual(parseExceptions('[]'), { exceptions: [], findings: [] });
  assert.equal(parseExceptions(yaml(entry({ expires: '2026-11-24T00:00:00.500+07:00' }))).exceptions.length, 1);
});

test('starci app audit runs npm audit itself, prints the active exceptions on a pass and fails on a finding; now is injectable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-audit-'));
  try {
    fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify(lock()));
    fs.mkdirSync(path.join(root, '.starcistacks', 'security'), { recursive: true });
    let args: readonly string[] = [];
    const go = (argv: string[], over: { now?: Date; stdout?: string } = {}) => {
      let out = '';
      let err = '';
      const npm = (_cwd: string, given: readonly string[]) => { args = given; return { stdout: over.stdout ?? JSON.stringify(report()) }; };
      const code = auditMain(argv, { cwd: root, stdout: (s) => { out += s; }, stderr: (s) => { err += s; }, run: npm, now: () => over.now ?? NOW });
      return { code, out, err };
    };
    const failed = go(['--omit-dev', '--level=high']);
    assert.deepEqual([failed.code, args], [1, ['audit', '--omit=dev', '--json']]);
    assert.match(failed.err, /^AUDIT_HIGH: bad high GHSA-2222-3333-4444/m);
    fs.writeFileSync(path.join(root, '.starcistacks', 'security', 'audit-exceptions.yaml'), yaml(entry()));
    const passed = go(['--omit-dev', '--level', 'high']);
    assert.equal(passed.code, 0);
    assert.match(passed.out, /^AUDIT_EXCEPTION_ACTIVE: active exception: advisory GHSA-2222-3333-4444/m);
    assert.equal(go(['--omit-dev'], { now: new Date('2026-12-01T00:00:00Z') }).code, 1, 'the same exception, expired by the injected clock');
    // --from judges a saved report; npm is not run.
    fs.writeFileSync(path.join(root, 'saved.json'), JSON.stringify(report()));
    assert.equal(go(['--omit-dev', '--from', 'saved.json']).code, 0);
    // AUDIT_REPORT_UNREADABLE: no report, a report that is an npm error, and bad usage.
    const empty = go(['--omit-dev'], { stdout: '' });
    assert.equal(empty.code, 1);
    assert.match(empty.err, /^AUDIT_REPORT_UNREADABLE: /);
    assert.match(go(['--omit-dev'], { stdout: JSON.stringify({ error: { code: 'ENOTFOUND', summary: 'offline' } }) }).err, /npm audit failed: offline/);
    assert.equal(go(['--level', 'severe']).code, 2);
    assert.equal(go(['--nope']).code, 2);
    assert.equal(go(['--level']).code, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---- the step the CI renders, and the step the pre-push parity runs, are one command ----

const sha = 'a'.repeat(40);
const workflow = (step: string) => `on:\n  push:\n    tags: [v*]\n  workflow_dispatch:\npermissions:\n  contents: read\nconcurrency: x\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n${step}\n`;
const NPM_POLICY = '\n    groups:\n      minor-and-patch:\n        applies-to: version-updates\n        update-types: [minor, patch]\n      security:\n        applies-to: security-updates\n        update-types: [minor, patch]\n    ignore:\n      - dependency-name: "@starci/*"';
const dependabot = `version: 2\nupdates:\n${['npm', 'github-actions', 'docker'].map((each) => `  - package-ecosystem: ${each}\n    directory: /\n    schedule:\n      interval: weekly${each === 'npm' ? NPM_POLICY : ''}`).join('\n')}\n`;
const images = workflow(`      - uses: docker/build-push-action@${sha}\n        with:\n          sbom: true\n          provenance: mode=max`);

function audit(step: string, edition: string): string[] {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-audit-step-'));
  try {
    const content: Record<string, string> = { '.github/dependabot.yml': dependabot, '.github/workflows/ci.yml': workflow(step), '.github/workflows/images.yml': images };
    for (const [file, text] of Object.entries(content)) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); }
    return supplyChainFindings({ repoRoot: root, files: Object.keys(content), repo: { kind: 'app', edition } as never, isRoot: true }).map((finding: { code: string }) => finding.code);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

for (const edition of ['lite'] as const) {
  test(`HFS_AUDIT_STEP_MISSING accepts the rendered starci app audit step and rejects one that swallows it (${edition})`, () => {
    for (const command of ['npx --no-install starci app audit --omit-dev --level=high', 'starci app audit --omit-dev --level=high', 'npx starci app audit --omit-dev']) assert.deepEqual(audit(`      - run: ${command}`, edition), [], command);
    for (const command of [
      `npx --no-install starci app audit --omit-dev ${OR_TRUE}`, 'npx --no-install starci app audit --omit-dev || echo ok', 'npx --no-install starci app audit --omit-dev; exit 0',
      'npx --no-install starci app audit --level=high', 'echo npx --no-install starci app audit --omit-dev', 'false && npx --no-install starci app audit --omit-dev',
    ]) assert.deepEqual(audit(`      - run: |\n          ${command}`, edition), ['HFS_AUDIT_STEP_MISSING'], command);
    assert.deepEqual(audit('      - run: npx --no-install starci app audit --omit-dev\n        continue-on-error: true', edition), ['HFS_AUDIT_STEP_MISSING']);
    assert.deepEqual(audit('      - run: npx --no-install starci app audit --omit-dev\n        if: false', edition), ['HFS_AUDIT_STEP_MISSING']);
  });

  test(`the managed ci.yml renders the audit step as starci app audit, and the pre-push parity runs that same command (${edition})`, () => {
    const targets = renderTargets({ ...structuredClone(APP), edition }, PRESETS, { source: { files: [], read: () => '', hasImage: () => true } as never });
    const ci = targets.find((target) => target.path === '.github/workflows/ci.yml')?.content ?? '';
    const command = ciWorkflowCommands(undefined)['auditCommand'];
    assert.equal(command, 'npx --no-install starci app audit --omit-dev --level=high');
    const steps = parityStepsOf(ci).filter((step) => step.family === 'audit');
    assert.deepEqual(steps.map((step) => [step.name, step.run]), [['production dependency audit', command]]);
    assert.equal(familyOfStep('fast', 'production dependency audit'), 'audit');
    assert.match(ci, /\n {6}- name: production dependency audit\n {8}run: npx --no-install starci app audit --omit-dev --level=high\n/u);
    const at = ci.indexOf('production dependency audit');
    assert.ok(!/continue-on-error|\|\| true/u.test(ci.slice(at, at + 200)));
    // The level and omitDev of the quality declaration are honoured.
    assert.equal(ciWorkflowCommands(undefined, undefined, { audit: { level: 'moderate', omitDev: true } } as never)['auditCommand'], 'npx --no-install starci app audit --omit-dev --level=moderate');
    assert.deepEqual(audit(`      - run: ${steps[0]?.run}`, edition), []);
  });
}
