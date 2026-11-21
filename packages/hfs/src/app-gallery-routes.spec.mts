// R395 coverage and change coupling (rules/gallery.mts routeFindings, rules/gallery-coupling.mts, gallery-routes.mts; contexts/project/gallery.md PROJECT-GALLERY-4):
// every `page.tsx` route of the front end has a gallery screen whose explain.md `route` matches it (or a reasoned exclusion in gallery/routes.json), judged from the explain.md
// files alone. The finding is `local`: report-only in `--env local`, errors in `--env prod`.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { bundledPresets } from '../sync/index.mjs';
import { scaffoldApp, starterDeclaration } from '../scaffold/app.mjs';
import type { LockResult } from '../scaffold/app.mjs';
import { init } from '../runtime/scripts/api/git/init.mjs';
import { appGalleryFindings } from '../runtime/scripts/hfs/rules/gallery.mjs';
import { changedSince } from '../runtime/scripts/hfs/rules/gallery-coupling.mjs';
import { feRoutes, importedFeatures, pageRoute, routeExclusions, routeKey } from '../runtime/scripts/hfs/gallery-routes.mjs';
import { judgedForEnv, localOnlyCodes } from '../runtime/scripts/hfs/check-env.mjs';
import { A15_CODES } from '../runtime/scripts/hfs/rules/a15-findings.mjs';
import { loadSlotManifest } from '../runtime/scripts/hfs/slots.mjs';

const HARNESS = { version: '1.1.0-alpha.3' };
const lockedOk = (root: string): LockResult => {
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  return { ok: true };
};
const at = (root: string, ...parts: string[]): string => path.join(root, ...parts);
const write = (root: string, file: string, text: string): void => {
  fs.mkdirSync(path.dirname(at(root, ...file.split('/'))), { recursive: true });
  fs.writeFileSync(at(root, ...file.split('/')), text);
};
const codes = (list: { code: string }[]): string[] => list.map((finding) => finding.code);

function starter(t: TestContext, edition: string): string {
  const into = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-gallery-routes-'));
  t.after(() => fs.rmSync(into, { recursive: true, force: true }));
  return scaffoldApp({ name: 'demo', harness: HARNESS, into, edition, presets: bundledPresets(), lock: lockedOk, initGit: init }).root;
}
const findings = (root: string, edition = 'lite') => appGalleryFindings({ repoRoot: root, repo: { kind: 'app', edition } as never, isRoot: true, all: [] });
const explain = (route: string, area = 'agents'): string => `---\ntitle: T\nroute: ${route}\narea: ${area}\n---\n## Header\nVì sao: because\nLuật: l\nGrammar: \`Page\`\n`;

const AGENTS = 'fe/apps/web/src/app/[locale]/workspaces/[workspaceId]/(console)/agents';
const DETAIL = `${AGENTS}/[agentKey]/page.tsx`;
const FEATURE = 'fe/apps/web/src/features/pages/AgentProfilePage';
const PAGE_TEXT = (feature: string): string => `import { ${feature} } from "@/features/pages/${feature}"\nexport default ${feature}\n`;

/** The routes of a Next app router tree become one key each; the locale prefix, the groups, parallel slots and private folders are not part of a route. */
test('a route is its page folder without the locale, the groups, a parallel slot or a private folder; a dynamic segment is one wildcard in the key', () => {
  assert.equal(pageRoute('[locale]'), '/');
  assert.equal(pageRoute('[locale]/(console)/agents/[agentKey]'), '/agents/[agentKey]');
  assert.equal(pageRoute('[locale]/workspaces/[workspaceId]/(console)/settings'), '/workspaces/[workspaceId]/settings');
  assert.equal(pageRoute('[locale]/@modal/photo'), null);
  assert.equal(pageRoute('[locale]/(.)photo'), null);
  assert.equal(pageRoute('[locale]/_parts/x'), null);
  assert.equal(routeKey('/workspaces/[workspaceId]/agents/[agentKey]'), routeKey('/workspaces/:id/agents/:key/'));
  assert.equal(routeKey('/[locale]/Agents/{key}?tab=a#x'), '/agents/*');
  assert.equal(routeKey('/docs/[...slug]'), '/docs/*');
  assert.equal(routeKey(''), '/');
  assert.deepEqual(importedFeatures('import { A } from "@/features/pages/AgentProfilePage"\nimport { L } from "../../features/layouts/ConsoleLayout"\nexport { B } from "@/features/pages/Other/index"'), ['features/pages/AgentProfilePage/', 'features/pages/Other/']);
});

test('routes.json: an absent file has no exclusion; a reason is required; a bad shape names the problem', () => {
  assert.deepEqual(routeExclusions(null), { exclusions: [], problem: null });
  assert.deepEqual(routeExclusions('{"exclude":[{"route":"/dev","reason":"developer tool"}]}'), { exclusions: [{ route: '/dev', reason: 'developer tool' }], problem: null });
  assert.match(routeExclusions('{"exclude":[{"route":"/dev"}]}').problem ?? '', /without a text "route" or a non-empty "reason"/u);
  assert.match(routeExclusions('{"exclude":[{"route":"/dev","reason":" "}]}').problem ?? '', /non-empty "reason"/u);
  assert.match(routeExclusions('[]').problem ?? '', /\{ "exclude"/u);
  assert.equal(routeExclusions('nope').problem, 'is not JSON');
});

test('the rule is wired: ROUTE_MISSING ships with the check, the code is localOnly and the slot of routes.json is declared', () => {
  assert.ok(A15_CODES.includes('HFS_APP_GALLERY_ROUTE_MISSING'));
  assert.ok(localOnlyCodes().has('HFS_APP_GALLERY_ROUTE_MISSING'));
  const slots = new Map(loadSlotManifest().slots.map((slot) => [slot.id, slot]));
  assert.equal(slots.get('app.gallery-routes')?.path, 'gallery/routes.json');
  assert.equal(slots.get('app.gallery-routes')?.tracked, 'tracked');
});

for (const edition of ['lite'] as const) {
  test(`a ${edition} scaffold ships a screen for each of its starter routes, so the coverage is green`, (t) => {
    const root = starter(t, edition);
    const routes = feRoutes(root);
    assert.deepEqual(routes.map((route) => route.route).sort(), edition === 'lite' ? ['/', '/auth/confirm', '/auth/forgot', '/auth/resend', '/auth/reset', '/auth/signup'] : ['/', '/']);
    assert.deepEqual(findings(root, edition), []);
  });
}

test('a route with no screen is HFS_APP_GALLERY_ROUTE_MISSING (report-only in local, an error in prod); a dynamic route is one screen whatever its parameter is called', (t) => {
  const root = starter(t, 'lite');
  write(root, `${AGENTS}/page.tsx`, 'export default () => null\n');
  write(root, DETAIL, PAGE_TEXT('AgentProfilePage'));
  const missing = findings(root);
  assert.deepEqual(codes(missing), ['HFS_APP_GALLERY_ROUTE_MISSING', 'HFS_APP_GALLERY_ROUTE_MISSING']);
  assert.deepEqual(missing.map((finding) => finding.path).sort(), [`${AGENTS}/page.tsx`, DETAIL].sort());
  assert.match(missing.find((finding) => finding.path === DETAIL)?.message ?? '', /the route \/workspaces\/\[workspaceId\]\/agents\/\[agentKey\] of web has no screen in gallery\/pages\//u);
  assert.equal(missing[0]?.level, 'error');
  assert.equal(missing[0]?.['local'], true);
  assert.equal(judgedForEnv(missing, 'local')[0]?.report, true, 'local: reported, not blocking');
  assert.equal(judgedForEnv(missing, 'prod')[0]?.report, undefined, 'prod: blocking');
  write(root, 'gallery/pages/agents/list/explain.md', explain('/workspaces/:workspaceId/agents'));
  write(root, 'gallery/pages/agents/profile/explain.md', explain('/workspaces/:id/agents/:key'));
  assert.deepEqual(findings(root), [], 'the screens cover the routes; the shots are not needed');
  fs.rmSync(at(root, 'gallery', 'pages', 'agents', 'profile', 'explain.md'));
  assert.deepEqual(codes(findings(root)), ['HFS_APP_GALLERY_ROUTE_MISSING'], 'a screen folder with no explain.md covers nothing');
});

test('shots saved without an explain.md cover nothing: the coverage reads explain.md alone', (t) => {
  const root = starter(t, 'lite');
  write(root, `${AGENTS}/page.tsx`, 'export default () => null\n');
  write(root, 'gallery/pages/agents/list/1440.png', 'png');
  assert.deepEqual(codes(findings(root)).sort(), ['HFS_APP_GALLERY_EXPLAIN_MISSING', 'HFS_APP_GALLERY_ROUTE_MISSING']);
});

test('gallery/routes.json excludes a developer-only route with its reason; a missing reason or a route the front end lacks is HFS_APP_GALLERY_LINKS', (t) => {
  const root = starter(t, 'lite');
  write(root, 'fe/apps/web/src/app/[locale]/dev/flow-canvas/page.tsx', 'export default () => null\n');
  assert.deepEqual(codes(findings(root)), ['HFS_APP_GALLERY_ROUTE_MISSING']);
  write(root, 'gallery/routes.json', JSON.stringify({ exclude: [{ route: '/dev/flow-canvas', reason: 'a developer tool, not a product screen' }] }));
  assert.deepEqual(findings(root), []);
  write(root, 'gallery/routes.json', JSON.stringify({ exclude: [{ route: '/dev/flow-canvas', reason: 'x' }, { route: '/gone', reason: 'removed' }] }));
  const [stale, ...rest] = findings(root);
  assert.equal(stale?.code, 'HFS_APP_GALLERY_LINKS');
  assert.match(stale?.message ?? '', /excludes "\/gone", which is no route of the front end/u);
  assert.deepEqual(rest, []);
  write(root, 'gallery/routes.json', JSON.stringify({ exclude: [{ route: '/dev/flow-canvas' }] }));
  assert.deepEqual(codes(findings(root)).sort(), ['HFS_APP_GALLERY_LINKS', 'HFS_APP_GALLERY_ROUTE_MISSING']);
});

test('an app with no front end has no routes to cover', (t) => {
  const root = starter(t, 'lite');
  fs.rmSync(at(root, 'fe'), { recursive: true });
  assert.deepEqual(feRoutes(root), []);
  assert.deepEqual(findings(root), []);
});

const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const git = (cwd: string, ...args: string[]): string => {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8', env: gitEnv, windowsHide: true });
  assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`);
  return run.stdout;
};

test('the range since the base names every changed file, a missing base none', (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-gallery-coupling-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'a@b.c');
  git(root, 'config', 'user.name', 'n');
  git(root, 'config', 'commit.gpgsign', 'false');
  write(root, 'hfs.json', `${JSON.stringify(starterDeclaration('fixture', undefined), null, 2)}\n`);
  write(root, `${FEATURE}/index.tsx`, 'export const AgentProfilePage = () => null\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'one');
  const base = git(root, 'rev-parse', 'HEAD').trim();
  write(root, `${FEATURE}/index.tsx`, 'export const AgentProfilePage = () => 1\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'two');
  assert.deepEqual(changedSince(root, base), [`${FEATURE}/index.tsx`]);
  assert.deepEqual(changedSince(root, null), []);
});

// ---- routes keyed by app: two apps serving "/" (a landing and the product) stay apart
const HOME_WEB = 'fe/apps/web/src/features/pages/HomePage';
const HOME_LANDING = 'fe/apps/landing/src/features/pages/LandingPage';
function twoAppsServingRoot(t: TestContext, webApp?: string): string {
  const root = starter(t, 'lite');
  write(root, 'fe/apps/web/src/app/[locale]/page.tsx', PAGE_TEXT('HomePage'));
  write(root, `${HOME_WEB}/index.tsx`, 'export const HomePage = () => null\n');
  write(root, 'fe/apps/landing/src/app/[locale]/page.tsx', PAGE_TEXT('LandingPage'));
  write(root, `${HOME_LANDING}/index.tsx`, 'export const LandingPage = () => null\n');
  write(root, 'gallery/pages/learn/home/explain.md', explain('/', 'learn').replace('area: learn', `area: learn${webApp === undefined ? '' : `\napp: ${webApp}`}`));
  write(root, 'gallery/pages/site/landing/explain.md', explain('/', 'site').replace('area: site', 'area: site\napp: landing'));
  return root;
}

test('two apps serving "/" are two routes: a change in one app\'s page marks only that app\'s screen, and a screen naming no app is ambiguous', (t) => {
  const root = twoAppsServingRoot(t, 'web');
  assert.deepEqual([...new Set(feRoutes(root).filter((route) => route.route === '/').map((route) => route.key))].sort(), ['landing:/', 'web:/']);
  assert.deepEqual(findings(root).filter((finding) => finding.code === 'HFS_APP_GALLERY_ROUTE_AMBIGUOUS' && /learn\/home|site\/landing/u.test(finding.message)), [], 'a screen that names its app is never ambiguous');
  const ambiguous = twoAppsServingRoot(t);
  const [first] = findings(ambiguous).filter((finding) => finding.code === 'HFS_APP_GALLERY_ROUTE_AMBIGUOUS' && /learn\/home/u.test(finding.message));
  assert.match(first?.message ?? '', /gallery\/pages\/learn\/home\/explain\.md|learn\/home/u);
  assert.match(first?.message ?? '', /landing and web|web and landing/u);
});
