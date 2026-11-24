// proves: UI_AUDIT_MISSING
// proves: UI_AUDIT_MISSING
// proves: UI_AUDIT_STALE
// proves: UI_AUDIT_STALE
// proves: UI_AUDIT_SELF_REVIEW
// proves: UI_AUDIT_SELF_REVIEW
// proves: UI_AUDIT_ROUNDS_FEW
// proves: UI_AUDIT_ROUNDS_FEW
// proves: UI_AUDIT_OPEN
// proves: UI_AUDIT_OPEN
// proves: UI_AUDIT_NEEDS_OWNER
// proves: UI_AUDIT_NEEDS_OWNER
// proves: UI_AUDIT_CONSIDERED_EMPTY
// proves: UI_AUDIT_CONSIDERED_EMPTY
// proves: HFS_APP_GALLERY_SCREEN_INVALID
// proves: HFS_APP_GALLERY_SCREEN_INVALID
// The UI Audit gate (cache/uiaudit-family.mts, rules/screen-yaml.mts; contexts/project/gallery.md PROJECT-GALLERY-8; owner 2026-11-21, train 188): a screen the diff touches carries a
// screen.yaml audit whose first cycle passes (2 to 4 rounds of the ten lenses by an auditor who is not the builder, on the shots it records, with the options considered); that pass is its
// baseline, and after it nothing about the audit (drift, later cycles) is a finding. A malformed audit block is HFS_APP_GALLERY_SCREEN_INVALID for every screen. An unchanged screen is
// grandfathered; `audit run` prepares the next round and records the baseline; `audit cycle` opens the next cycle.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { starterDeclaration } from '../scaffold/app.mjs';
import { changedSince } from '../runtime/scripts/hfs/rules/gallery-coupling.mjs';
import { appGalleryFindings } from '../runtime/scripts/hfs/rules/gallery.mjs';
import { CONTENT_LENSES, CORE_LENSES, isoInstant, LENS_MEANING, LENSES, parseScreen, stringifyYaml, judgeAudit } from '../runtime/scripts/hfs/screen-yaml.mjs';
import { uiAuditFindings } from '../cache/uiaudit-family.mjs';
import { uiauditMain } from '../uiaudit/cli.mjs';

const PAGE = 'fe/apps/web/src/app/[locale]/(console)/customers/page.tsx';
const FEATURE = 'fe/apps/web/src/features/pages/CustomersPage/index.tsx';
const FOLDER = 'gallery/pages/customers/list';
const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const git = (cwd: string, ...args: string[]): string => {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8', env: gitEnv, windowsHide: true });
  assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`);
  return run.stdout;
};
const write = (root: string, file: string, text: string | Buffer): void => {
  fs.mkdirSync(path.dirname(path.join(root, ...file.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(root, ...file.split('/')), text);
};
const sha = (bytes: string): string => crypto.createHash('sha256').update(bytes).digest('hex');
const lenses = (verdicts: Partial<Record<(typeof LENSES)[number], string>> = {}): Record<string, unknown> => Object.fromEntries(LENSES.map((lens) => [lens, { verdict: verdicts[lens] ?? 'pass', notes: verdicts[lens] === undefined || verdicts[lens] === 'pass' ? '' : 'noted' }]));
const round = (n: number, verdicts: Partial<Record<(typeof LENSES)[number], string>> = {}) => ({ n, at: '2026-11-19T12:00:00Z', lenses: lenses(verdicts) });
const screen = (over: Record<string, unknown> = {}): string => stringifyYaml({
  schema: 1, screen: 'customers/list', title: 'Khách hàng', route: '/customers', area: 'customers', summary: 'Danh sách khách hàng', code: ['features/pages/CustomersPage'],
  shots: { 1440: { file: '1440.png', sha256: sha('a') }, 390: { file: '390.png', sha256: sha('b') } },
  sections: [{ id: 'header', title: 'Dải đầu', shows: 'Tên', why: 'Cần biết ngay', actions: ['Thêm'], states: { loading: 'Skeleton', empty: null }, needsApi: [] }],
  considered: [{ option: 'Bảng', chosen: true, why: 'Quét nhanh' }],
  audit: { builder: { agent: 'lane-a' }, auditor: { agent: 'lane-b' }, rounds: [round(1, { order: 'fixed' }), round(2)], escalate: null }, ...over,
});

/** An app with one screen (route /customers) committed with `yaml`; the base is that commit. */
function app(t: TestContext, _edition: string, yaml: string | null): { root: string; base: string } {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-ui-audit-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'a@b.c');
  git(root, 'config', 'user.name', 'n');
  git(root, 'config', 'commit.gpgsign', 'false');
  write(root, 'hfs.json', `${JSON.stringify(starterDeclaration('fixture', undefined), null, 2)}\n`);
  write(root, PAGE, 'import { CustomersPage } from "@/features/pages/CustomersPage"\nexport default CustomersPage\n');
  write(root, FEATURE, 'export const CustomersPage = () => null\n');
  if (yaml !== null) write(root, `${FOLDER}/screen.yaml`, yaml);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'one');
  return { root, base: git(root, 'rev-parse', 'HEAD').trim() };
}
/** An audit whose first cycle has not passed (round 2 still has a lens open): the gate still judges its shots and code. */
const unpassed = { builder: { agent: 'lane-a' }, auditor: { agent: 'lane-b' }, rounds: [round(1, { order: 'open' }), round(2, { states: 'open' })], escalate: null };
const touchSource = (root: string): void => write(root, FEATURE, 'export const CustomersPage = () => 1\n');
const codes = (root: string, base: string): string[] => uiAuditFindings({ repoRoot: root, changed: changedSince(root, base), base }).findings.map((finding) => String(finding.code));
const io = (cwd: string) => { const out: string[] = []; const err: string[] = []; return { out, err, io: { cwd, stdout: (text: string) => out.push(text), stderr: (text: string) => err.push(text) } }; };

for (const edition of ['lite'] as const) {
  test(`an unchanged screen is grandfathered, even with no audit`, (t) => {
    const { root, base } = app(t, edition, screen({ audit: null }));
    assert.deepEqual(codes(root, base), []);
    write(root, 'README.md', 'x');
    assert.deepEqual(codes(root, base), []);
  });

  test(`a changed screen with no audit is UI_AUDIT_MISSING; one whose first cycle has not passed is stale on an old screen.yaml; one that passed once is never judged`, (t) => {
    const bare = app(t, edition, screen({ audit: null }));
    touchSource(bare.root);
    assert.deepEqual(codes(bare.root, bare.base), ['UI_AUDIT_MISSING']);
    const first = app(t, edition, screen({ audit: unpassed }));
    touchSource(first.root);
    assert.deepEqual(codes(first.root, first.base), ['UI_AUDIT_STALE', 'UI_AUDIT_OPEN']);
    const passed = app(t, edition, screen());
    touchSource(passed.root);
    assert.deepEqual(codes(passed.root, passed.base), [], 'the pass is the baseline: drift is evidence, not a finding');
    write(passed.root, `${FOLDER}/1440.png`, 'drifted');
    assert.deepEqual(codes(passed.root, passed.base), []);
  });

  test(`a catalog over the rule read budget (1 MiB) counts only for the screens that read a changed key`, (t) => {
    const CATALOG = 'fe/apps/web/src/modules/i18n/messages/vi.json';
    const catalog = (title: string, other: string): string => {
      const pad = Object.fromEntries(Array.from({ length: 11000 }, (_, i) => [`k${String(i)}`, 'x'.repeat(100)]));
      return `${JSON.stringify({ customers: { customersTitle: title }, approvals: { otherNote: other }, pad }, null, 2)}\n`;
    };
    const { root } = app(t, edition, screen({ audit: unpassed }));
    // the reach resolves imports with the app's own TypeScript: the fixture borrows this package's, linked (and unlinked before the folder goes)
    const linked = path.join(root, 'node_modules', 'typescript');
    fs.mkdirSync(path.dirname(linked), { recursive: true });
    fs.symlinkSync(path.dirname(createRequire(import.meta.url).resolve('typescript/package.json')), linked, 'junction');
    try {
      write(root, '.gitignore', 'node_modules/\n');
      write(root, CATALOG, catalog('Khách hàng', 'Ghi chú'));
      write(root, FEATURE, 'import vi from "../../../modules/i18n/messages/vi.json"\nconst KEY = "customers.customersTitle"\nexport const CustomersPage = () => KEY.split(".").reduce((at: any, part) => at[part], vi)\n');
      write(root, 'fe/apps/web/tsconfig.json', `${JSON.stringify({ compilerOptions: { resolveJsonModule: true, module: 'esnext', moduleResolution: 'bundler', jsx: 'preserve', baseUrl: '.', paths: { '@/*': ['./src/*'] } } })}\n`);
      git(root, 'add', '-A');
      git(root, 'commit', '-q', '-m', 'catalog');
      const base = git(root, 'rev-parse', 'HEAD').trim();
      assert.ok(fs.statSync(path.join(root, CATALOG)).size > 1024 * 1024);
      write(root, CATALOG, catalog('Khách hàng', 'Ghi chú mới'));
      assert.deepEqual(codes(root, base), [], 'a key the screen does not read');
      write(root, CATALOG, catalog('Mọi khách hàng', 'Ghi chú mới'));
      assert.deepEqual(codes(root, base), ['UI_AUDIT_STALE', 'UI_AUDIT_OPEN'], 'a key the screen reads');
    } finally {
      fs.unlinkSync(linked);
    }
  });

  test(`shot hashes on disk must match the audited ones; a fresh checkout without PNGs is not judged`, (t) => {
    const { root, base } = app(t, edition, screen({ audit: unpassed }));
    touchSource(root);
    write(root, `${FOLDER}/screen.yaml`, screen({ summary: 'mới', audit: unpassed }));
    write(root, `${FOLDER}/1440.png`, 'a');
    write(root, `${FOLDER}/390.png`, 'b');
    assert.deepEqual(codes(root, base), ['UI_AUDIT_OPEN']);
    write(root, `${FOLDER}/390.png`, 'changed');
    assert.deepEqual(codes(root, base), ['UI_AUDIT_STALE', 'UI_AUDIT_OPEN']);
  });

  test(`builder equal to auditor, fewer than two rounds, open lenses, the fourth round and an empty considered`, () => {
    const facts = (over: Record<string, unknown>) => judgeAudit({ id: 'customers/list', value: JSON.parse(JSON.stringify({ ...(JSON.parse(JSON.stringify({ audit: null })) as object), ...over })) as Record<string, unknown>, disk: {}, unrecorded: false });
    const base = { shots: { 1440: { sha256: sha('a') }, 390: { sha256: sha('b') } }, considered: [{ option: 'a', chosen: true, why: 'b' }] };
    const audit = (rounds: unknown[], auditor = 'lane-b') => ({ builder: { agent: 'Lane-A' }, auditor: { agent: auditor }, rounds, escalate: null });
    const codesOf = (over: Record<string, unknown>) => facts({ ...base, ...over }).map((finding) => finding.code);
    assert.deepEqual(codesOf({ audit: audit([round(1), round(2)], ' lane-a ') }), ['UI_AUDIT_SELF_REVIEW']);
    assert.deepEqual(codesOf({ audit: audit([round(1)]) }), ['UI_AUDIT_ROUNDS_FEW']);
    assert.deepEqual(codesOf({ audit: audit([round(1), round(2, { states: 'open' })]) }), ['UI_AUDIT_OPEN']);
    assert.deepEqual(codesOf({ audit: audit([round(1, { states: 'open' }), round(2, { states: 'open' }), round(3, { states: 'open' }), round(4, { states: 'open' })]) }), ['UI_AUDIT_NEEDS_OWNER']);
    assert.deepEqual(codesOf({ audit: audit([round(1), round(2, { states: 'open' })]), considered: [] }), ['UI_AUDIT_OPEN', 'UI_AUDIT_CONSIDERED_EMPTY']);
    // a malformed block is HFS_APP_GALLERY_SCREEN_INVALID (the gallery rule), not a finding of the gate
    assert.deepEqual(codesOf({ audit: { ...audit([round(1), { n: 2, at: '2026-11-19T12:00:00Z', lenses: { order: { verdict: 'pass' } } }]) } }), []);
    assert.deepEqual(codesOf({ audit: audit([round(1), round(2)]) }), []);
    // passed once: a later round with a lens open, five rounds, a later cycle: none is judged
    assert.deepEqual(codesOf({ audit: audit([round(1), round(2), round(3, { layout: 'open' })]) }), ['UI_AUDIT_OPEN'], 'no baseline recorded yet: the current rounds decide');
    assert.deepEqual(codesOf({ audit: { ...audit([round(1), round(2), round(3, { layout: 'open' })]), baseline: { at: '2026-11-19T12:00:00Z', rounds: 2 } } }), []);
    assert.deepEqual(codesOf({ audit: { ...audit([round(1, { layout: 'open' })]), baseline: { at: '2026-11-19T12:00:00Z', rounds: 2 } } }), []);
  });

  test(`the audit block is part of the screen.yaml schema; what the rounds found is not a schema problem`, () => {
    const doc = (audit: unknown) => parseScreen(screen({ audit }), 'customers/list');
    const audit = (rounds: unknown[], auditor = 'lane-b') => ({ builder: { agent: 'Lane-A' }, auditor: { agent: auditor }, rounds, escalate: null });
    // open lenses, one round, the builder as auditor, five rounds: evidence, the document stays well formed
    assert.deepEqual(doc(audit([round(1), round(2, { states: 'open' })])).audit, []);
    assert.deepEqual(doc(audit([round(1)], 'lane-a')).audit, []);
    assert.deepEqual(doc(audit([round(1), round(2), round(3), round(4), round(5, { states: 'open' })])).audit, []);
    // a malformed block is not
    assert.match(doc(audit([round(1), { n: 2, at: '2026-11-19 12:00:00', lenses: { order: { verdict: 'pass' } } }])).audit.join('; '), /at is not an ISO timestamp/);
    assert.match(doc({ builder: { agent: 'a' }, rounds: 'x' }).audit.join('; '), /auditor\.agent is missing/);
  });

  test(`the three content lenses (business, hand-composed, tech-leak): a round carries all ten; a round from before them carries the seven core ones`, () => {
    assert.deepEqual([...CONTENT_LENSES], ['business', 'hand-composed', 'tech-leak']);
    assert.equal(LENSES.length, CORE_LENSES.length + CONTENT_LENSES.length);
    for (const lens of CONTENT_LENSES) assert.match(LENS_MEANING[lens], /content\.md|situations\.md/);
    const doc = (rounds: unknown[]) => parseScreen(screen({ audit: { builder: { agent: 'Lane-A' }, auditor: { agent: 'lane-b' }, rounds, escalate: null } }), 'customers/list').audit;
    const legacy = (n: number) => ({ n, at: '2026-11-19T12:00:00Z', lenses: Object.fromEntries(Object.entries(round(n).lenses).filter(([lens]) => !(CONTENT_LENSES as readonly string[]).includes(lens))) });
    assert.deepEqual(doc([legacy(1), legacy(2)]), [], 'a round from before the content lenses stays valid');
    const partial = { n: 2, at: '2026-11-19T12:00:00Z', lenses: { ...legacy(2).lenses, business: { verdict: 'pass' } } };
    assert.match(doc([legacy(1), partial]).join('; '), /lenses\.hand-composed is missing/);
    const judged = (rounds: unknown[]) => judgeAudit({ id: 'customers/list', value: { shots: { 1440: { sha256: sha('a') }, 390: { sha256: sha('b') } }, considered: [{ option: 'a', chosen: true, why: 'b' }], audit: { builder: { agent: 'Lane-A' }, auditor: { agent: 'lane-b' }, rounds, escalate: null } }, disk: {}, unrecorded: false }).map((finding) => finding.code);
    assert.deepEqual(judged([round(1), round(2, { 'tech-leak': 'open' })]), ['UI_AUDIT_OPEN'], 'an open content lens keeps the first cycle open');
    assert.deepEqual(judged([legacy(1), legacy(2)]), [], 'a legacy pass on the seven core lenses passes');
  });

  test(`screen.yaml questions (contexts/ui/content.md): optional, and when present the 2 or 3 owner questions as texts`, () => {
    const doc = (questions: unknown) => parseScreen(screen({ questions }), 'customers/list').doc.join('; ');
    assert.doesNotMatch(doc(['Hôm nay bán được bao nhiêu?', 'Việc gì cần tôi?']), /questions/);
    assert.doesNotMatch(parseScreen(screen(), 'customers/list').doc.join('; '), /questions/, 'a screen from before the rule passes');
    assert.match(doc(['Một câu?']), /questions is the 2 or 3 owner questions/);
    assert.match(doc(['a?', 'b?', 'c?', 'd?']), /questions is the 2 or 3/);
    assert.match(doc('Một câu'), /questions is the 2 or 3/);
  });

  test(`a timestamp PyYAML rewrote (space, microseconds, +00:00) is still an instant with its zone, and audit run writes it back as ISO`, (t) => {
    const pyyaml = '2026-11-19 12:00:00.425000+00:00';
    const doc = (at: string) => parseScreen(screen({ audit: { builder: { agent: 'lane-a' }, auditor: { agent: 'lane-b' }, rounds: [{ ...round(1), at }, round(2)], escalate: null, baseline: { at, rounds: 2 } } }), 'customers/list').audit;
    assert.deepEqual(doc(pyyaml), []);
    assert.deepEqual(doc('2026-11-19T19:00:00.425+07:00'), []);
    assert.match(doc('2026-11-19 12:00:00.425000').join('; '), /at is not an ISO timestamp/, 'a time with no zone names no instant');
    assert.equal(isoInstant(pyyaml), '2026-11-19T12:00:00.425Z');
    assert.equal(isoInstant('2026-11-19T19:00:00.4+07:00'), '2026-11-19T12:00:00.400Z');
    assert.equal(isoInstant('2026-13-40 12:00:00Z'), null);
    const { root } = app(t, edition, screen({ audit: { builder: { agent: 'lane-a' }, auditor: { agent: 'lane-b' }, rounds: [{ ...round(1, { order: 'fixed' }), at: pyyaml }, { ...round(2), at: pyyaml }], escalate: null, baseline: { at: pyyaml, rounds: 2 } } }).replaceAll(`'${pyyaml}'`, pyyaml).replaceAll(`"${pyyaml}"`, pyyaml));
    const file = path.join(root, FOLDER, 'screen.yaml');
    assert.match(fs.readFileSync(file, 'utf8'), /at: 2026-11-19 12:00:00\.425000\+00:00/, 'the fixture is the unquoted form PyYAML dumps');
    write(root, `${FOLDER}/1440.png`, 'x');
    write(root, `${FOLDER}/390.png`, 'y');
    const run = io(root);
    assert.equal(uiauditMain(['run', 'customers/list'], run.io), 0, run.err.join(''));
    const written = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(written, /\.425000\+00:00/);
    assert.equal(written.match(/2026-11-19T12:00:00\.425Z/gu)?.length, 3, 'both rounds and the baseline are rewritten as ISO');
    assert.deepEqual(parseScreen(written, 'customers/list').audit, []);
  });

  test(`a malformed audit block is HFS_APP_GALLERY_SCREEN_INVALID; open lenses are not`, (t) => {
    const bad = app(t, edition, screen({ audit: { builder: { agent: 'a' }, auditor: { agent: 'b' }, rounds: [{ n: 1, at: 'yesterday', lenses: {} }], escalate: null } }));
    const declared = JSON.parse(fs.readFileSync(path.join(bad.root, 'hfs.json'), 'utf8')) as { kind?: string };
    const codesOf = (root: string) => appGalleryFindings({ repoRoot: root, repo: { ...declared, kind: 'app', edition } as never, isRoot: true, all: [] }).map((finding) => String(finding.code));
    assert.ok(codesOf(bad.root).includes('HFS_APP_GALLERY_SCREEN_INVALID'));
    const open = app(t, edition, screen({ audit: { builder: { agent: 'a' }, auditor: { agent: 'a' }, rounds: [round(1, { layout: 'open' })], escalate: null } }));
    assert.ok(!codesOf(open.root).includes('HFS_APP_GALLERY_SCREEN_INVALID'), codesOf(open.root).join(','));
  });

  test(`audit run records nothing after a cycle's round 4; audit cycle closes it into considered and run opens round 1`, (t) => {
    const four = [round(1, { layout: 'open' }), round(2, { layout: 'open' }), round(3, { layout: 'open' }), round(4, { layout: 'open' })];
    const { root } = app(t, edition, screen({ audit: { builder: { agent: 'lane-a' }, auditor: { agent: 'lane-b' }, rounds: four, escalate: 'needs owner: layout' } }));
    write(root, `${FOLDER}/1440.png`, 'new-wide');
    write(root, `${FOLDER}/390.png`, 'new-narrow');
    const file = path.join(root, FOLDER, 'screen.yaml');
    const before = fs.readFileSync(file, 'utf8');
    const capped = io(root);
    assert.equal(uiauditMain(['run', 'customers/list'], capped.io), 0, capped.err.join(''));
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'a closed cycle keeps the shots its last round judged');
    assert.match(capped.err.join(''), /starci audit cycle/);
    const usage = io(root);
    assert.equal(uiauditMain(['cycle', 'customers/list'], usage.io), 2, 'cycle needs a reason');
    const cycled = io(root);
    assert.equal(uiauditMain(['cycle', 'customers/list', '--reason', 'layout fixed after round 4'], cycled.io), 0, cycled.err.join(''));
    const reopened = fs.readFileSync(file, 'utf8');
    assert.match(reopened, /layout fixed after round 4/);
    assert.match(reopened, /ran 4 rounds/);
    assert.match(reopened, /layout open/);
    assert.match(reopened, /rounds: \[\]/);
    assert.doesNotMatch(reopened, /baseline:/, 'a first cycle that never passed leaves no baseline: the new cycle is still the first to pass');
    const next = io(root);
    assert.equal(uiauditMain(['run', 'customers/list'], next.io), 0, next.err.join(''));
    const opened = fs.readFileSync(file, 'utf8');
    assert.match(opened, new RegExp(sha('new-wide')));
    assert.match(opened, /n: 1/);
    const none = app(t, edition, screen({ audit: null }));
    const nothing = io(none.root);
    assert.equal(uiauditMain(['cycle', 'customers/list', '--reason', 'x'], nothing.io), 1);
  });

  test(`audit run records the baseline the first time the rounds pass, and a new cycle keeps it`, (t) => {
    const { root } = app(t, edition, screen());
    write(root, `${FOLDER}/1440.png`, 'x');
    write(root, `${FOLDER}/390.png`, 'y');
    const file = path.join(root, FOLDER, 'screen.yaml');
    const run = io(root);
    assert.equal(uiauditMain(['run', 'customers/list'], run.io), 0, run.err.join(''));
    assert.match(fs.readFileSync(file, 'utf8'), /baseline:\n\s+at: .*\n\s+rounds: 2/);
    const cycled = io(root);
    assert.equal(uiauditMain(['cycle', 'customers/list', '--reason', 'the owner dislikes the header'], cycled.io), 0, cycled.err.join(''));
    assert.match(fs.readFileSync(file, 'utf8'), /baseline:\n\s+at: .*\n\s+rounds: 2/);
  });

  test(`R395 reads screen.yaml, flags an invalid one and the route coverage counts it`, (t) => {
    const { root } = app(t, edition, screen({ title: '' }));
    const declared = JSON.parse(fs.readFileSync(path.join(root, 'hfs.json'), 'utf8')) as { kind?: string };
    const found = appGalleryFindings({ repoRoot: root, repo: { ...declared, kind: 'app', edition } as never, isRoot: true, all: [] }).map((finding) => String(finding.code));
    assert.ok(found.includes('HFS_APP_GALLERY_SCREEN_INVALID'), found.join(','));
    assert.ok(!found.includes('HFS_APP_GALLERY_ROUTE_MISSING'), 'screen.yaml route covers /customers');
    fs.rmSync(path.join(root, FOLDER, 'screen.yaml'));
    write(root, `${FOLDER}/explain.md`, '---\ntitle: T\nroute: /customers\narea: customers\n---\n## Header\nVì sao: because\nLuật: l\nGrammar: `Page`\n');
    const legacy = appGalleryFindings({ repoRoot: root, repo: { ...declared, kind: 'app', edition } as never, isRoot: true, all: [] }).map((finding) => String(finding.code));
    assert.ok(!legacy.includes('HFS_APP_GALLERY_EXPLAIN_MISSING') && !legacy.includes('HFS_APP_GALLERY_ROUTE_MISSING'), legacy.join(','));
  });

  test(`audit run records the shots and writes ten open lenses; status lists it`, (t) => {
    const { root } = app(t, edition, screen({ audit: null }));
    write(root, `${FOLDER}/1440.png`, 'x');
    write(root, `${FOLDER}/390.png`, 'y');
    const first = io(root);
    assert.equal(uiauditMain(['run', 'customers/list', '--builder', 'lane-a', '--auditor', 'lane-b'], first.io), 0, first.err.join(''));
    assert.match(first.out.join(''), /UI audit brief: customers\/list/);
    const written = fs.readFileSync(path.join(root, FOLDER, 'screen.yaml'), 'utf8');
    assert.match(written, new RegExp(sha('x')));
    for (const lens of LENSES) assert.match(written, new RegExp(`${lens}:`));
    const status = io(root);
    uiauditMain(['status'], status.io);
    assert.match(status.out.join(''), /pending\s+customers\/list/);
    const noShots = io(root);
    fs.rmSync(path.join(root, FOLDER, '390.png'));
    assert.equal(uiauditMain(['run', 'customers/list'], noShots.io), 2);

  });
}
