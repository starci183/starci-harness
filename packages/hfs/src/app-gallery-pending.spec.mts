// proves: HFS_APP_GALLERY_DESIGN_PENDING
// proves: HFS_APP_GALLERY_DESIGN_PENDING
// A screen design.json marks `pending: { reason }` (not buildable yet: it waits on data or an API) is skipped by the UI Audit, and a pending screen with no reason is refused (rules/gallery-design.mts).
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { starterDeclaration } from '../scaffold/app.mjs';
import { parseDesign } from '../runtime/scripts/hfs/rules/gallery-design.mjs';

const PAGE = 'fe/apps/web/src/app/[locale]/(console)/premium/page.tsx';
const BOARD = 'https://claude.ai/artifact/0123abcd';
const OLD = '2026-11-11T09:00:00+07:00';
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
const explain = (route: string): string => `---\ntitle: T\nroute: ${route}\narea: premium\n---\n## Header\nVì sao: because\nLuật: l\nGrammar: \`Page\`\n`;
const entry = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ status: 'approved', approvedAt: OLD, board: BOARD, ...extra });
const manifest = (pages: Record<string, unknown>): string => `${JSON.stringify({ areas: ['premium'], pages }, null, 2)}\n`;

/** An app with the route /premium, two screens on it (the page and its query state), a manifest, and one commit that is the base. */
function app(t: TestContext, pages: Record<string, unknown>): { root: string; base: string } {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-gallery-pending-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'a@b.c');
  git(root, 'config', 'user.name', 'n');
  git(root, 'config', 'commit.gpgsign', 'false');
  write(root, 'hfs.json', `${JSON.stringify(starterDeclaration('fixture', undefined), null, 2)}\n`);
  write(root, PAGE, 'export default function Premium() { return null }\n');
  write(root, 'gallery/pages/premium/plans/explain.md', explain('/premium'));
  write(root, 'gallery/pages/premium/qr-payment/explain.md', explain('/premium?step=qr'));
  write(root, '.starcistacks/canvas/design.json', manifest(pages));
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'one');
  return { root, base: git(root, 'rev-parse', 'HEAD').trim() };
}

test('a pending screen with an empty or missing reason is refused, and a built page cannot be pending', () => {
  for (const pending of [{ reason: '' }, { reason: '   ' }, {}, 'later', { reason: 'x', extra: 1 }]) {
    const { manifest: parsed, problems } = parseDesign(manifest({ 'premium/qr-payment': entry({ pending }) }));
    assert.equal(parsed, null, JSON.stringify(pending));
    assert.match(problems.join(' '), /pending/u);
  }
  assert.match(parseDesign(manifest({ 'premium/qr-payment': entry({ status: 'built', shots: {}, pending: { reason: 'x' } }) })).problems.join(' '), /built and still pending/u);
  assert.notEqual(parseDesign(manifest({ 'premium/qr-payment': entry({ pending: { reason: 'waits on data' } }) })).manifest, null);
});
