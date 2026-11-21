// The boundary helpers of rules/error-pages.mts that state-pages.mts (R447) reads: the closure of a boundary file and the page empty state it draws.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BOUNDARY, closure, drawsPageEmptyState } from '../runtime/scripts/hfs/rules/error-pages.mjs';

const EMPTY = `import { EmptyNotice } from "@starci/grammar/common"
export const Notice = () => <EmptyNotice scope="page" message="m" media={{ illustration: { staticsKey: "illustrations/errors/not-found.webp" } }} actionLabel="Home" actionHref="/" />
`;

/** Writes `tree` (path to text) into a temp repository and returns its root and the tracked list. */
function repoOf(tree: Record<string, string>): { root: string; files: string[] } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'error-pages-'));
  for (const [file, text] of Object.entries(tree)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return { root, files: Object.keys(tree) };
}

const drawn = (tree: Record<string, string>, boundary: string): boolean => {
  const { root, files } = repoOf(tree);
  const appRoot = (BOUNDARY.exec(boundary)?.groups?.app ?? '').replace(/\/$/u, '');
  const uiFiles = files.filter((file) => /^packages\/[^/]+-ui\/src\/.+\.tsx$/u.test(file));
  return drawsPageEmptyState(closure(boundary, appRoot, new Set(files), uiFiles, root).map((member) => fs.readFileSync(path.join(root, member), 'utf8')));
};

test('the closure follows the app files and an import of the workspace ui package by the name it imports', () => {
  const boundary = 'apps/app/src/app/[locale]/not-found.tsx';
  assert.equal(drawn({
    [boundary]: 'import { AppNotFoundPage } from "@/features/pages/AppNotFoundPage"\nexport default () => <AppNotFoundPage />\n',
    'apps/app/src/features/pages/AppNotFoundPage/index.tsx': 'import { NotFoundNotice } from "@shop/ui"\nexport const AppNotFoundPage = () => <NotFoundNotice />\n',
    'packages/shop-ui/src/composites/NotFoundNotice/index.tsx': EMPTY.replace('export const Notice', 'export const NotFoundNotice'),
  }, boundary), true);
  assert.equal(drawn({ [boundary]: 'import { Alert } from "@starci/grammar/common"\nexport default () => <Alert title="x" tone="negative" />\n' }, boundary), false);
});

test('a boundary held by a route group directly under [locale] is a boundary like the one at [locale]', () => {
  assert.ok(BOUNDARY.test('apps/web/src/app/[locale]/(pages)/error.tsx'));
  assert.ok(BOUNDARY.test('apps/web/src/app/global-error.tsx'));
});

test('drawsPageEmptyState reads the element, not the file: scope page and an illustration must belong to one EmptyNotice', () => {
  assert.equal(drawsPageEmptyState([EMPTY]), true);
  assert.equal(drawsPageEmptyState(['<EmptyNotice scope="region" message="m" />', 'const illustration = 1; const scope = "page"']), false);
  assert.equal(drawsPageEmptyState(['<G.EmptyNotice scope="page" media={{ illustration: { src } }} message="m"></G.EmptyNotice>']), true);
});
