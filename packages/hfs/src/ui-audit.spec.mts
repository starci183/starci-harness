// proves: HFS_APP_GALLERY_SCREEN_INVALID
// proves: HFS_APP_GALLERY_SCREEN_INVALID
// screen.yaml (rules/screen-yaml.mts; contexts/project/gallery.md PROJECT-GALLERY-8): the one check left of the UI audit is that each screen.yaml is well formed, its audit block
// included (HFS_APP_GALLERY_SCREEN_INVALID). The audit rounds are evidence, never a gate (owner, 2026-11-21): no finding for open lenses, the round count or shots drifted since.
// `audit run` prepares the next round and records nothing after a cycle's round 4; `audit cycle` closes a cycle into `considered` and opens the next; `migrate-explain` turns
// explain.md into screen.yaml.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { starterDeclaration } from '../scaffold/app.mjs';
import { appGalleryFindings } from '../runtime/scripts/hfs/rules/gallery.mjs';
import { LENSES, parseScreen, screenOfExplain, stringifyYaml } from '../runtime/scripts/hfs/screen-yaml.mjs';
import { galleryMain, uiauditMain } from '../uiaudit/cli.mjs';

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
const io = (cwd: string) => { const out: string[] = []; const err: string[] = []; return { out, err, io: { cwd, stdout: (text: string) => out.push(text), stderr: (text: string) => err.push(text) } }; };

for (const edition of ['lite'] as const) {
  test(`the audit block is part of the screen.yaml schema; what the rounds found is never a finding`, () => {
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
    const next = io(root);
    assert.equal(uiauditMain(['run', 'customers/list'], next.io), 0, next.err.join(''));
    const opened = fs.readFileSync(file, 'utf8');
    assert.match(opened, new RegExp(sha('new-wide')));
    assert.match(opened, /n: 1/);
    const none = app(t, edition, screen({ audit: null }));
    const nothing = io(none.root);
    assert.equal(uiauditMain(['cycle', 'customers/list', '--reason', 'x'], nothing.io), 1);
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

  test(`audit run records the shots and writes seven open lenses; status lists it; migrate-explain converts and deletes`, (t) => {
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

    const migrate = app(t, edition, null);
    write(migrate.root, `${FOLDER}/explain.md`, '---\ntitle: Khách hàng\nroute: /customers\narea: customers\n---\nGiới thiệu\n## Dải đầu\nVì sao: cần biết ngay\nLuật: l\nGrammar: `Page`\n## Phương án đã cân nhắc\n- Bảng, chọn vì quét nhanh\n');
    const dry = io(migrate.root);
    assert.equal(galleryMain(['migrate-explain'], dry.io), 0);
    assert.ok(fs.existsSync(path.join(migrate.root, FOLDER, 'explain.md')), 'a dry run changes nothing');
    const done = io(migrate.root);
    assert.equal(galleryMain(['migrate-explain', '--execute'], done.io), 0, done.err.join(''));
    assert.ok(!fs.existsSync(path.join(migrate.root, FOLDER, 'explain.md')));
    const converted = fs.readFileSync(path.join(migrate.root, FOLDER, 'screen.yaml'), 'utf8');
    assert.match(converted, /audit: null/);
    assert.match(converted, /features\/pages\/CustomersPage/);
    assert.deepEqual(screenOfExplain({ id: 'customers/list', markdown: '---\ntitle: T\nroute: /x\narea: customers\n---\n', disk: {} })['sections'], []);
  });
}
