// proves: HFS_APP_GALLERY_DESIGN_CRITIQUE_MISSING
// proves: HFS_APP_GALLERY_DESIGN_CRITIQUE_MISSING
// proves: HFS_APP_GALLERY_DESIGN_MANIFEST
// proves: HFS_APP_GALLERY_DESIGN_MANIFEST
// proves: HFS_APP_GALLERY_DESIGN_PAGE_MISSING
// proves: HFS_APP_GALLERY_DESIGN_PAGE_MISSING
// proves: HFS_APP_GALLERY_DESIGN_SHOT_MISSING
// proves: HFS_APP_GALLERY_DESIGN_SHOT_MISSING
// proves: HFS_APP_GALLERY_DESIGN_SHOT_STALE
// proves: HFS_APP_GALLERY_DESIGN_SHOT_STALE
// R395, the design pass drawn before code (rules/gallery-design.mts; contexts/project/gallery.md PROJECT-GALLERY-6): .starcistacks/canvas/design.json records each screen's design status
// (drafted, approved, built, matches); a built page has its screen and the sha256 of its 1440 and 390 shots, recorded after the approval and equal to the shots in the work tree
// wherever they exist; a screen needs no owner approval to be built (owner decision 2026-11-25). The manifest's shape is an error; the rest are `local` (report-only in `--env local`).
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appGalleryFindings, GALLERY_FILES } from '../runtime/scripts/hfs/rules/gallery.mjs';
import { DESIGN_STATUSES, parseDesign } from '../runtime/scripts/hfs/rules/gallery-design.mjs';
import { localOnlyCodes } from '../runtime/scripts/hfs/check-env.mjs';
import { A15_CODES } from '../runtime/scripts/hfs/rules/a15-findings.mjs';
import { loadSlotManifest } from '../runtime/scripts/hfs/slots.mjs';

const CODES = ['HFS_APP_GALLERY_DESIGN_MANIFEST', 'HFS_APP_GALLERY_DESIGN_PAGE_MISSING', 'HFS_APP_GALLERY_DESIGN_SHOT_MISSING', 'HFS_APP_GALLERY_DESIGN_SHOT_STALE'];
const BOARD = 'https://claude.ai/artifact/0123abcd';
const APPROVED = '2026-11-17T09:30:00+07:00';
const EXPLAIN = (area: string): string => `---\ntitle: Khách hàng\nroute: /customers\narea: ${area}\n---\nChủ shop tìm lại một khách trong 5 giây.\n\n## Danh sách\nVì sao: tìm theo tên hoặc số điện thoại.\nLuật: PROJECT-GALLERY-2\nGrammar: \`List\`\n`;
const PNG = { '1440': Buffer.from('shot-1440'), '390': Buffer.from('shot-390') };
const sha = (bytes: Buffer): string => crypto.createHash('sha256').update(bytes).digest('hex');
const SHOTS = { '1440': sha(PNG['1440']), '390': sha(PNG['390']) };

const write = (root: string, file: string, body: string | Buffer): void => {
  const target = path.join(root, ...file.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body);
};
/** An app root with the gallery's managed files (content is not judged here), a screen per id with its explain.md, and the manifest. */
function app(t: TestContext, screens: string[], design: unknown): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-gallery-design-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of GALLERY_FILES) write(root, `gallery/${file}`, file === 'package.json' ? '{"scripts":{"dev":"vite --port 3150 --strictPort"},"devDependencies":{"vite":"6.3.5"}}\n' : '\n');
  write(root, '.gitignore', 'gallery/pages/**/*.png\n');
  for (const id of screens) write(root, `gallery/pages/${id}/explain.md`, EXPLAIN(id.split('/')[0] as string));
  if (design !== undefined) write(root, '.starcistacks/canvas/design.json', typeof design === 'string' ? design : JSON.stringify(design));
  return root;
}
const shoot = (root: string, id: string, widths: (keyof typeof PNG)[] = ['1440', '390']): void => {
  for (const width of widths) write(root, `gallery/pages/${id}/${width}.png`, PNG[width]);
};
const design = (findingsOf: ReturnType<typeof run>) => findingsOf.filter((finding) => finding.code.startsWith('HFS_APP_GALLERY_DESIGN_') && finding.code !== 'HFS_APP_GALLERY_DESIGN_CRITIQUE_MISSING');
const run = (root: string, edition = 'lite') => appGalleryFindings({ repoRoot: root, repo: { kind: 'app', edition } as never, isRoot: true, all: [] }) as { code: string; path: string; message: string; local?: boolean; level?: string }[];
const codes = (list: { code: string }[]): string[] => list.map((finding) => finding.code);

test('the design codes ship with the check, all but the manifest are localOnly, and the canvas folder .starcistacks/canvas/ has its tracked slot', () => {
  for (const code of CODES) assert.ok(A15_CODES.includes(code), code);
  assert.deepEqual(CODES.filter((code) => localOnlyCodes().has(code)), CODES.slice(1));
  const slot = loadSlotManifest().slots.find((entry) => entry.id === 'app.starcistacks.canvas');
  assert.equal(slot?.path, '.starcistacks/canvas/');
  assert.ok(slot?.allows?.includes('design.json'));
  assert.equal(slot?.tracked, 'tracked');
  assert.deepEqual([...DESIGN_STATUSES], ['drafted', 'approved', 'built', 'matches']);
});

test('an app without .starcistacks/canvas/design.json has no design finding: the design pass is opt-in per area', (t) => {
  assert.deepEqual(design(run(app(t, ['customers/list'], undefined))), []);
});

test('parseDesign: the shape, the page ids, the statuses, approvedAt from approved on only, an https board and sha256 shots of 1440 and 390', () => {
  assert.deepEqual(parseDesign('{"areas":[],"pages":{}}'), { manifest: { areas: [], pages: {} }, problems: [] });
  assert.deepEqual(parseDesign('nope').problems, ['is not JSON']);
  assert.match(parseDesign('[]').problems[0] ?? '', /not an object/u);
  assert.match(parseDesign('{"areas":"x","pages":{}}').problems.join(';'), /no "areas" list/u);
  assert.match(parseDesign('{"areas":[],"pages":{},"grammar":[]}').problems.join(';'), /unknown key "grammar"/u);
  const one = (page: unknown, id = 'customers/list') => parseDesign(JSON.stringify({ areas: ['customers'], pages: { [id]: page } })).problems.join(';');
  assert.equal(one({ status: 'drafted', board: BOARD }), '');
  assert.equal(one({ status: 'matches', board: BOARD, approvedAt: APPROVED, shots: SHOTS }), '');
  assert.match(one({ status: 'drafted', board: BOARD }, 'Customers/list'), /not "<area>\/<screen>"/u);
  assert.match(one({ status: 'drafted', board: BOARD }, 'orders/list'), /area "orders", which "areas" does not list/u);
  assert.match(one({ status: 'done', board: BOARD }), /status "done"/u);
  assert.match(one({ status: 'approved', board: BOARD }), /without an ISO "approvedAt"/u);
  assert.match(one({ status: 'approved', board: BOARD, approvedAt: 'yesterday' }), /without an ISO "approvedAt"/u);
  assert.match(one({ status: 'approved', board: BOARD, approvedAt: '2026-11-17' }), /a bare date such as 2026-11-17 is refused/u);
  assert.match(one({ status: 'drafted', board: BOARD, approvedAt: APPROVED }), /only an approved page has it/u);
  assert.match(one({ status: 'drafted', board: 'http://x' }), /no "board"/u);
  assert.match(one({ status: 'built', board: BOARD, approvedAt: APPROVED, shots: { '1920': SHOTS['1440'] } }), /width "1920"/u);
  assert.match(one({ status: 'built', board: BOARD, approvedAt: APPROVED, shots: { '1440': 'ABC' } }), /not a lowercase sha256/u);
  assert.match(one({ status: 'built', board: BOARD, approvedAt: APPROVED, note: 1 }), /unknown key "note"/u);
});

for (const edition of ['lite'] as const) {
  test(`an unreadable or misshapen manifest is HFS_APP_GALLERY_DESIGN_MANIFEST, an error even in --env local`, (t) => {
    const broken = design(run(app(t, [], '{ "areas": '), edition));
    assert.deepEqual(codes(broken), ['HFS_APP_GALLERY_DESIGN_MANIFEST']);
    assert.equal(broken[0]?.path, '.starcistacks/canvas/design.json');
    assert.equal(broken[0]?.local, undefined);
    assert.equal(broken[0]?.level, 'error');
    assert.deepEqual(codes(design(run(app(t, [], { areas: ['customers'], pages: { 'customers/list': { status: 'approved', board: BOARD } } }), edition))), ['HFS_APP_GALLERY_DESIGN_MANIFEST']);
  });

  test(`a built page with no gallery screen is HFS_APP_GALLERY_DESIGN_PAGE_MISSING; an approved page waits for its build`, (t) => {
    const root = app(t, [], { areas: ['customers'], pages: { 'customers/list': { status: 'built', board: BOARD, approvedAt: APPROVED, shots: SHOTS }, 'customers/list-empty': { status: 'approved', board: BOARD, approvedAt: APPROVED } } });
    const found = design(run(root, edition));
    assert.deepEqual(codes(found), ['HFS_APP_GALLERY_DESIGN_PAGE_MISSING']);
    assert.match(found[0]?.message ?? '', /customers\/list is built and gallery\/pages\/customers\/list\/explain\.md does not exist/u);
    assert.equal(found[0]?.local, true);
  });

  test(`a screen of a designed area with no entry or a drafted one is built without any finding: design needs no owner approval`, (t) => {
    const root = app(t, ['customers/list', 'customers/list-empty', 'customers/detail', 'orders/list'], {
      areas: ['customers'],
      pages: { 'customers/list': { status: 'approved', board: BOARD, approvedAt: APPROVED }, 'customers/list-empty': { status: 'drafted', board: BOARD } },
    });
    assert.deepEqual(codes(design(run(root, edition))), []);
  });

  test(`a built page without a recorded sha, or whose work tree holds shots without one width, is HFS_APP_GALLERY_DESIGN_SHOT_MISSING`, (t) => {
    const root = app(t, ['customers/list'], { areas: ['customers'], pages: { 'customers/list': { status: 'built', board: BOARD, approvedAt: APPROVED, shots: { '1440': SHOTS['1440'] } } } });
    let found = design(run(root, edition));
    assert.deepEqual(codes(found), ['HFS_APP_GALLERY_DESIGN_SHOT_MISSING']);
    assert.match(found[0]?.message ?? '', /records no sha of its 390 shot/u);
    assert.equal(found[0]?.path, '.starcistacks/canvas/design.json', 'judged from the manifest: a fresh checkout has no PNG');
    write(root, '.starcistacks/canvas/design.json', JSON.stringify({ areas: ['customers'], pages: { 'customers/list': { status: 'built', board: BOARD, approvedAt: APPROVED, shots: SHOTS } } }));
    assert.deepEqual(design(run(root, edition)), [], 'no PNG in the work tree (CI): the recorded shas stand');
    shoot(root, 'customers/list', ['1440']);
    found = design(run(root, edition));
    assert.deepEqual(codes(found), ['HFS_APP_GALLERY_DESIGN_SHOT_MISSING']);
    assert.equal(found[0]?.path, 'gallery/pages/customers/list/390.png');
    shoot(root, 'customers/list');
    assert.deepEqual(design(run(root, edition)), [], 'both shots, equal to the record');
  });

  test(`a shot record older than the approval, or a shot that is not the recorded one, is HFS_APP_GALLERY_DESIGN_SHOT_STALE`, (t) => {
    const root = app(t, ['customers/list'], { areas: ['customers'], pages: { 'customers/list': { status: 'approved', board: BOARD, approvedAt: APPROVED, shots: SHOTS } } });
    let found = design(run(root, edition));
    assert.deepEqual(codes(found), ['HFS_APP_GALLERY_DESIGN_SHOT_STALE']);
    assert.match(found[0]?.message ?? '', /is approved and still records shots/u);
    write(root, '.starcistacks/canvas/design.json', JSON.stringify({ areas: ['customers'], pages: { 'customers/list': { status: 'matches', board: BOARD, approvedAt: APPROVED, shots: SHOTS } } }));
    shoot(root, 'customers/list');
    assert.deepEqual(design(run(root, edition)), []);
    write(root, 'gallery/pages/customers/list/390.png', Buffer.from('shot again'));
    found = design(run(root, edition));
    assert.deepEqual(codes(found), ['HFS_APP_GALLERY_DESIGN_SHOT_STALE']);
    assert.equal(found[0]?.path, 'gallery/pages/customers/list/390.png');
    assert.match(found[0]?.message ?? '', /not the shot \.starcistacks\/canvas\/design\.json records for the matches page/u);
    assert.ok(found.every((finding) => finding.local === true));
  });
}

test('the design canvas folder is a slot of its own: its files are owned, no stacks shape finding, never an environment', async (t) => {
  const { openHfs } = await import('../runtime/scripts/hfs/slots.mjs');
  const { stacksFindings, RESERVED_STACK_FOLDERS } = await import('../runtime/scripts/hfs/rules/stacks.mjs');
  assert.ok(RESERVED_STACK_FOLDERS.has('canvas'));
  for (const edition of ['lite'] as const) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-canvas-slot-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.writeFileSync(path.join(root, 'hfs.json'), JSON.stringify({ hfs: 3, kind: 'app', edition, project: 'canvas-slot', sides: { be: { apps: [{ name: 'api', kind: 'api' }] }, fe: { apps: [{ name: 'web', kind: 'next' }] } } }));
    const opened = openHfs({ repoRoot: root });
    const canvas = ['.starcistacks/canvas/design.json', '.starcistacks/canvas/tokens.css', '.starcistacks/canvas/canvas.css', '.starcistacks/canvas/briefs/01-customers-list.md', '.starcistacks/canvas/pages/01-customers-list.html', '.starcistacks/canvas/web-design.html'];
    for (const file of canvas) assert.equal(opened.classifyPath(file).status, 'owned', `${file}`);
    assert.deepEqual(stacksFindings({ repoRoot: root, files: canvas, resolver: opened }), []);
  }
});

// The critique record (PROJECT-GALLERY-7 item 3): a matches page needs "## Phương án đã cân nhắc" in its explain.md.
for (const edition of ['lite'] as const) {
  test(`a matches page without the options section is an error from the release on, and info (not final yet) before it`, (t) => {
    const page = (extra: Record<string, unknown>) => ({ areas: ['customers'], pages: { 'customers/list': { status: 'matches', board: BOARD, approvedAt: APPROVED, shots: SHOTS, ...extra } } });
    const critique = (root: string) => run(root, edition).filter((finding) => finding.code === 'HFS_APP_GALLERY_DESIGN_CRITIQUE_MISSING');
    const root = app(t, ['customers/list'], page({ matchedAt: '2026-11-18T16:00:00+07:00' }));
    let found = critique(root);
    assert.equal(found.length, 1);
    assert.equal(found[0]?.level, 'error');
    assert.equal(found[0]?.local, undefined);
    assert.equal(found[0]?.path, 'gallery/pages/customers/list/explain.md');
    write(root, '.starcistacks/canvas/design.json', JSON.stringify(page({ matchedAt: '2026-11-17T09:00:00+07:00' })));
    found = critique(root);
    assert.deepEqual(found.map((finding) => finding.level), ['info']);
    assert.match(found[0]?.message ?? '', /not final yet/u);
    write(root, '.starcistacks/canvas/design.json', JSON.stringify(page({})));
    assert.deepEqual(critique(root).map((finding) => finding.level), ['info'], 'no matchedAt: an older matches page');
    write(root, 'gallery/pages/customers/list/explain.md', `${EXPLAIN('customers')}\n## Phương án đã cân nhắc\n\n- Hai tab: loại, thành hai dải điều hướng chồng nhau.\n- Một thanh công cụ: chọn.\n`);
    write(root, '.starcistacks/canvas/design.json', JSON.stringify(page({ matchedAt: '2026-11-18T16:00:00+07:00' })));
    assert.deepEqual(critique(root), [], 'the section is a record, not a region: no region problem either');
    write(root, 'gallery/pages/customers/list/explain.md', `${EXPLAIN('customers')}\n## Phương án đã cân nhắc\n`);
    assert.equal(critique(root).length, 1, 'an empty section is no record');
  });

  test(`only a matches page may carry matchedAt, as an ISO timestamp`, () => {
    const one = (page: unknown) => parseDesign(JSON.stringify({ areas: ['customers'], pages: { 'customers/list': page } })).problems.join(';');
    assert.equal(one({ status: 'matches', board: BOARD, approvedAt: APPROVED, shots: SHOTS, matchedAt: '2026-11-18T16:00:00+07:00' }), '');
    assert.match(one({ status: 'built', board: BOARD, approvedAt: APPROVED, shots: SHOTS, matchedAt: '2026-11-18T16:00:00+07:00' }), /only a matches page has it/u);
    assert.match(one({ status: 'matches', board: BOARD, approvedAt: APPROVED, shots: SHOTS, matchedAt: '2026-11-18' }), /only a matches page has it/u);
  });
}
