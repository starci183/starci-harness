// proves: FE_ERROR_PAGE_NOT_EMPTY_STATE@lite
// proves: FE_ERROR_PAGE_NOT_EMPTY_STATE@full
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { drawsPageEmptyState, errorPageFindings } from '../runtime/scripts/hfs/rules/error-pages.mjs';

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

const LITE_OK = {
  'apps/web/src/app/[locale]/not-found.tsx': 'import { AppNotFoundPage } from "@/features/pages/AppNotFoundPage"\nexport default () => <AppNotFoundPage />\n',
  'apps/web/src/app/[locale]/error.tsx': 'import { AppErrorPage } from "@/features/pages/AppErrorPage"\nexport default () => <AppErrorPage />\n',
  'apps/web/src/app/global-error.tsx': 'import { AppGlobalErrorPage } from "@/features/pages/AppGlobalErrorPage"\nexport default () => <AppGlobalErrorPage />\n',
  'apps/web/src/features/pages/AppNotFoundPage/index.tsx': 'import { NotFoundNotice } from "@/components/composites/NotFoundNotice"\nexport const AppNotFoundPage = () => <NotFoundNotice />\n',
  'apps/web/src/features/pages/AppErrorPage/index.tsx': 'import { ErrorNotice } from "@/components/composites/ErrorNotice"\nexport const AppErrorPage = () => <ErrorNotice />\n',
  'apps/web/src/features/pages/AppGlobalErrorPage/index.tsx': 'import { GlobalErrorNotice } from "@/components/composites/GlobalErrorNotice"\nexport const AppGlobalErrorPage = () => <GlobalErrorNotice />\n',
  'apps/web/src/components/composites/NotFoundNotice/index.tsx': EMPTY,
  'apps/web/src/components/composites/ErrorNotice/index.tsx': EMPTY,
  'apps/web/src/components/composites/GlobalErrorNotice/index.tsx': EMPTY,
};

for (const edition of ['lite', 'full']) {
  test(`FE_ERROR_PAGE_NOT_EMPTY_STATE ${edition}: the template chain (route, feature page, composite) draws the page empty state`, () => {
    const { root, files } = repoOf(LITE_OK);
    assert.deepEqual(errorPageFindings({ files, repoRoot: root, repo: { profile: 'fe', edition } }), []);
  });

  test(`FE_ERROR_PAGE_NOT_EMPTY_STATE ${edition}: a hand-rolled page, and an empty state without its page scope or art, are refused`, () => {
    const { root, files } = repoOf({
      ...LITE_OK,
      'apps/web/src/components/composites/NotFoundNotice/index.tsx': 'import { Page, Link } from "@starci/grammar/common"\nexport const NotFoundNotice = () => <Page header={{ title: "x" }}><Link href="/">Home</Link></Page>\n',
      'apps/web/src/components/composites/ErrorNotice/index.tsx': 'import { EmptyNotice } from "@starci/grammar/common"\nexport const ErrorNotice = () => <EmptyNotice message="m" />\n',
    });
    const findings = errorPageFindings({ files, repoRoot: root, repo: { profile: 'fe', edition } });
    assert.deepEqual(findings.map((finding) => [finding.code, finding.path]), [
      ['FE_ERROR_PAGE_NOT_EMPTY_STATE', 'apps/web/src/app/[locale]/error.tsx'],
      ['FE_ERROR_PAGE_NOT_EMPTY_STATE', 'apps/web/src/app/[locale]/not-found.tsx'],
    ]);
    assert.equal(findings[0]?.level, 'error');
    assert.match(findings[0]?.message ?? '', /R443/u);
  });
}

test('the closure follows an import of the workspace ui package by the name it imports', () => {
  const { root, files } = repoOf({
    'apps/app/src/app/[locale]/not-found.tsx': 'import { AppNotFoundPage } from "@/features/pages/AppNotFoundPage"\nexport default () => <AppNotFoundPage />\n',
    'apps/app/src/features/pages/AppNotFoundPage/index.tsx': 'import { NotFoundNotice } from "@shop/ui"\nexport const AppNotFoundPage = () => <NotFoundNotice />\n',
    'packages/shop-ui/src/composites/NotFoundNotice/index.tsx': EMPTY.replace('export const Notice', 'export const NotFoundNotice'),
  });
  assert.deepEqual(errorPageFindings({ files, repoRoot: root, repo: { profile: 'fe', edition: 'full' } }), []);
  const hand = repoOf({
    'apps/app/src/app/[locale]/not-found.tsx': 'import { Alert } from "@starci/grammar/common"\nexport default () => <Alert title="x" tone="negative" />\n',
  });
  assert.equal(errorPageFindings({ files: hand.files, repoRoot: hand.root, repo: { profile: 'fe', edition: 'full' } }).length, 1);
});

test('the rule judges a front end only, never the app root, and inScope narrows the files', () => {
  const { root, files } = repoOf({ 'apps/web/src/app/global-error.tsx': 'export default () => <html />\n' });
  assert.equal(errorPageFindings({ files, repoRoot: root, repo: { profile: 'be', edition: 'full' } }).length, 0);
  assert.equal(errorPageFindings({ files, repoRoot: root, repo: { profile: 'fe', edition: 'full' }, isRoot: true }).length, 0);
  assert.equal(errorPageFindings({ files, repoRoot: root, repo: { profile: 'fe', edition: 'full' }, inScope: () => false }).length, 0);
  assert.equal(errorPageFindings({ files, repoRoot: root, repo: { profile: 'fe', edition: 'full' } }).length, 1);
});

test('drawsPageEmptyState reads the element, not the file: scope page and an illustration must belong to one EmptyNotice', () => {
  assert.equal(drawsPageEmptyState([EMPTY]), true);
  assert.equal(drawsPageEmptyState(['<EmptyNotice scope="region" message="m" />', 'const illustration = 1; const scope = "page"']), false);
  assert.equal(drawsPageEmptyState(['<G.EmptyNotice scope="page" media={{ illustration: { src } }} message="m"></G.EmptyNotice>']), true);
});
