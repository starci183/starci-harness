// proves: HFS_APP_GALLERY_DESIGN_CHANGE_UNAPPROVED@lite
// proves: HFS_APP_GALLERY_DESIGN_CHANGE_UNAPPROVED@full
// R395, a UI change goes canvas first (galleryDesignChangeFindings of rules/gallery-coupling.mts; contexts/project/gallery.md PROJECT-GALLERY-7): a change to the source of a canvas-managed screen
// needs its design.json page approved, at an `approvedAt` not earlier than the change, or the same change must update the page's entry. An area the canvas does not manage is never judged.
// The finding is `local`: report-only in `--env local`, an error in `--env prod`.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { starterDeclaration } from '../scaffold/app.mjs';
import { runWorkHygiene } from '../sync/hygiene.mjs';
import { changedSince, galleryDesignChangeFindings } from '../runtime/scripts/hfs/rules/gallery-coupling.mjs';
import { judgedForEnv, localOnlyCodes } from '../runtime/scripts/hfs/check-env.mjs';

const CODE = 'HFS_APP_GALLERY_DESIGN_CHANGE_UNAPPROVED';
const DETAIL = 'fe/apps/web/src/app/[locale]/(console)/customers/page.tsx';
const FEATURE = 'fe/apps/web/src/features/pages/CustomersPage';
const DESIGN = '.starcistacks/canvas/design.json';
const BOARD = 'https://claude.ai/artifact/0123abcd';
const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const git = (cwd: string, ...args: string[]): string => {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8', env: gitEnv, windowsHide: true });
  assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`);
  return run.stdout;
};
const write = (root: string, file: string, text: string): void => {
  fs.mkdirSync(path.dirname(path.join(root, ...file.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(root, ...file.split('/')), text);
};
const design = (areas: string[], pages: Record<string, unknown>): string => `${JSON.stringify({ areas, pages }, null, 2)}\n`;
const page = (status: string, approvedAt?: string): Record<string, unknown> => ({ status, ...(approvedAt === undefined ? {} : { approvedAt }), board: BOARD });
const explain = (area: string): string => `---\ntitle: T\nroute: /customers\narea: ${area}\n---\n## Header\nVì sao: because\nLuật: l\nGrammar: \`Page\`\n`;
const commit = (root: string, message: string, when: string): void => {
  git(root, 'add', '-A');
  const run = spawnSync('git', ['commit', '-q', '-m', message], { cwd: root, env: { ...gitEnv, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when }, encoding: 'utf8', windowsHide: true });
  assert.equal(run.status, 0, run.stderr);
};

/** An app with one screen `<area>/list` (route /customers); the first commit holds it with `manifest` (null: no canvas) and the base is that commit. */
function app(t: TestContext, _edition: string, manifest: string | null, area = 'customers'): { root: string; base: string } {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-gallery-design-change-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'a@b.c');
  git(root, 'config', 'user.name', 'n');
  git(root, 'config', 'commit.gpgsign', 'false');
  write(root, 'hfs.json', `${JSON.stringify(starterDeclaration('fixture', undefined), null, 2)}\n`);
  write(root, DETAIL, 'import { CustomersPage } from "@/features/pages/CustomersPage"\nexport default CustomersPage\n');
  write(root, `${FEATURE}/index.tsx`, 'export const CustomersPage = () => null\n');
  write(root, `gallery/pages/${area}/list/explain.md`, explain(area));
  if (manifest !== null) write(root, DESIGN, manifest);
  commit(root, 'one', '2026-11-10T10:00:00+07:00');
  return { root, base: git(root, 'rev-parse', 'HEAD').trim() };
}
const editSource = (root: string, body: string, when?: string): void => {
  write(root, `${FEATURE}/index.tsx`, `export const CustomersPage = () => ${body}\n`);
  if (when !== undefined) commit(root, 'two', when);
};
const judge = (root: string, base: string, now = Date.parse('2026-11-18T00:00:00Z')) => galleryDesignChangeFindings({ repoRoot: root, changed: changedSince(root, base), base, now });

for (const edition of ['lite'] as const) {
  test(`${edition}: a screen of an area the canvas does not manage is not flagged; neither is an app with no canvas`, (t) => {
    const unmanaged = app(t, edition, design(['orders'], { 'orders/list': page('drafted') }));
    editSource(unmanaged.root, '1', '2026-11-12T10:00:00+07:00');
    assert.deepEqual(judge(unmanaged.root, unmanaged.base), []);
    const none = app(t, edition, null);
    editSource(none.root, '1', '2026-11-12T10:00:00+07:00');
    assert.deepEqual(judge(none.root, none.base), []);
  });

  test(`${edition}: a managed screen with a drafted page, or none, is flagged`, (t) => {
    const drafted = app(t, edition, design(['customers'], { 'customers/list': page('drafted') }));
    editSource(drafted.root, '1', '2026-11-12T10:00:00+07:00');
    const [found] = judge(drafted.root, drafted.base);
    assert.equal(found?.code, CODE);
    assert.equal(found?.path, `${FEATURE}/index.tsx`);
    assert.match(found?.message ?? '', /customers\/list is only drafted/u);
    const missing = app(t, edition, design(['customers'], {}));
    editSource(missing.root, '1', '2026-11-12T10:00:00+07:00');
    assert.match(judge(missing.root, missing.base)[0]?.message ?? '', /customers\/list has no design entry/u);
  });

  test(`${edition}: a page approved before the change is flagged, approved after it passes; an uncommitted change counts as now`, (t) => {
    const before = app(t, edition, design(['customers'], { 'customers/list': page('approved', '2026-11-11T09:00:00+07:00') }));
    editSource(before.root, '1', '2026-11-12T10:00:00+07:00');
    assert.match(judge(before.root, before.base)[0]?.message ?? '', /approved at 2026-11-11T09:00:00\+07:00, before the change/u);
    const after = app(t, edition, design(['customers'], { 'customers/list': page('approved', '2026-11-12T11:00:00+07:00') }));
    editSource(after.root, '1', '2026-11-12T10:00:00+07:00');
    assert.deepEqual(judge(after.root, after.base), [], 'approved at 11:00, after the commit at 10:00');
    editSource(after.root, '2');
    assert.equal(judge(after.root, after.base)[0]?.code, CODE, 'a work-tree change is newer than the approval of 2026-11-12');
    assert.deepEqual(judge(after.root, after.base, Date.parse('2026-11-12T03:00:00Z')), [], 'unless the approval is later than now');
  });

  test(`${edition}: the same change that updates the page's entry passes, a drafted page still does not`, (t) => {
    const { root, base } = app(t, edition, design(['customers'], { 'customers/list': page('approved', '2026-11-01T09:00:00+07:00') }));
    editSource(root, '1');
    write(root, DESIGN, design(['customers'], { 'customers/list': page('approved', '2026-11-12T11:00:00+07:00') }));
    commit(root, 'two', '2026-11-12T10:00:00+07:00');
    assert.deepEqual(judge(root, base), [], 'a fresh approvedAt in the same range');
    editSource(root, '2');
    write(root, DESIGN, design(['customers'], { 'customers/list': page('drafted') }));
    assert.equal(judge(root, base).length, 1, 'a redraw that is not approved yet');
  });

  test(`${edition}: one finding per route; an excluded route is not judged`, (t) => {
    const { root, base } = app(t, edition, design(['customers'], { 'customers/list': page('drafted') }));
    write(root, `${FEATURE}/component.tsx`, 'export const x = 1\n');
    editSource(root, '1');
    assert.equal(judge(root, base).length, 1);
    write(root, 'gallery/routes.json', JSON.stringify({ exclude: [{ route: '/customers', reason: 'a redirect' }] }));
    assert.deepEqual(judge(root, base), []);
  });
}

test('the finding is local-only: a warning in --env local, an error in --env prod', (t) => {
  assert.ok(localOnlyCodes().has(CODE));
  const { root, base } = app(t, 'lite', design(['customers'], { 'customers/list': page('drafted') }));
  editSource(root, '1');
  const found = judge(root, base);
  assert.equal(judgedForEnv(found, 'local')[0]?.report, true);
  assert.equal(judgedForEnv(found, 'prod')[0]?.report, undefined);
});

test('the staged guard lists the finding and never blocks the commit', async (t) => {
  const { root } = app(t, 'lite', design(['customers'], { 'customers/list': page('drafted') }));
  editSource(root, '1');
  git(root, 'add', '-A');
  const lines: string[] = [];
  assert.equal(await runWorkHygiene({ cwd: root, out: (line) => lines.push(line) }), 0, lines.join('\n'));
  assert.ok(lines.some((line) => line.startsWith(`report ${CODE} `)), lines.join('\n'));
});
