// proves: UI_AUDIT_MISSING
// proves: UI_AUDIT_MISSING
// proves: UI_AUDIT_INVALID
// proves: UI_AUDIT_INVALID
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
// The UI Audit gate (cache/uiaudit-family.mts, rules/screen-yaml.mts; contexts/project/gallery.md PROJECT-GALLERY-8): a screen the diff touches carries a screen.yaml audit of 2 to 4 rounds of seven lenses by an auditor
// who is not the builder, on the shots it records, with the options considered; an unchanged screen is grandfathered; `audit run` prepares the next round; `migrate-explain` turns explain.md into screen.yaml.
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
import { LENSES, screenOfExplain, stringifyYaml, judgeAudit } from '../runtime/scripts/hfs/screen-yaml.mjs';
import { uiAuditFindings } from '../cache/uiaudit-family.mjs';
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

  test(`a changed screen with no audit is UI_AUDIT_MISSING, and with an audit but an old screen.yaml it is stale`, (t) => {
    const bare = app(t, edition, screen({ audit: null }));
    touchSource(bare.root);
    assert.deepEqual(codes(bare.root, bare.base), ['UI_AUDIT_MISSING']);
    const audited = app(t, edition, screen());
    touchSource(audited.root);
    assert.deepEqual(codes(audited.root, audited.base), ['UI_AUDIT_STALE']);
    write(audited.root, `${FOLDER}/screen.yaml`, screen({ summary: 'Danh sách khách hàng, bản mới' }));
    assert.deepEqual(codes(audited.root, audited.base), []);
  });

  test(`a catalog over the rule read budget (1 MiB) counts only for the screens that read a changed key`, (t) => {
    const CATALOG = 'fe/apps/web/src/modules/i18n/messages/vi.json';
    const catalog = (title: string, other: string): string => {
      const pad = Object.fromEntries(Array.from({ length: 11000 }, (_, i) => [`k${String(i)}`, 'x'.repeat(100)]));
      return `${JSON.stringify({ customers: { customersTitle: title }, approvals: { otherNote: other }, pad }, null, 2)}\n`;
    };
    const { root } = app(t, edition, screen());
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
      assert.deepEqual(codes(root, base), ['UI_AUDIT_STALE'], 'a key the screen reads');
    } finally {
      fs.unlinkSync(linked);
    }
  });

  test(`shot hashes on disk must match the audited ones; a fresh checkout without PNGs is not judged`, (t) => {
    const { root, base } = app(t, edition, screen());
    touchSource(root);
    write(root, `${FOLDER}/screen.yaml`, screen({ summary: 'mới' }));
    write(root, `${FOLDER}/1440.png`, 'a');
    write(root, `${FOLDER}/390.png`, 'b');
    assert.deepEqual(codes(root, base), []);
    write(root, `${FOLDER}/390.png`, 'changed');
    assert.deepEqual(codes(root, base), ['UI_AUDIT_STALE']);
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
    assert.deepEqual(codesOf({ audit: audit([round(1), round(2)]), considered: [] }), ['UI_AUDIT_CONSIDERED_EMPTY']);
    assert.deepEqual(codesOf({ audit: audit([round(1), round(2), round(3), round(4), round(5)]) }), ['UI_AUDIT_INVALID']);
    assert.deepEqual(codesOf({ audit: { ...audit([round(1), { n: 2, at: '2026-11-19T12:00:00Z', lenses: { order: { verdict: 'pass' } } }]) } }), ['UI_AUDIT_INVALID']);
    assert.deepEqual(codesOf({ audit: audit([round(1), round(2)]) }), []);
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
