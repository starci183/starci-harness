// proves: FE_I18N_PLACEMENT
// proves: FE_I18N_PLACEMENT
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appFrontendFindings, frontendFindings } from '../runtime/scripts/hfs/rules/frontend-tree.mjs';

function fixture(t: TestContext, edition: string) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-i18n-placement-'));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  const manifest = path.join(repoRoot, 'fe/apps/web/package.json');
  fs.mkdirSync(path.dirname(manifest), { recursive: true });
  fs.writeFileSync(manifest, JSON.stringify({ dependencies: { 'next-intl': '4.0.0' } }));
  return { repoRoot, repo: { edition, apps: [{ name: 'web', kind: 'next' }], sides: { fe: { apps: [{ name: 'web', kind: 'next' }], reads: [] } } } };
}

for (const edition of ['lite'] as const) {
  test(`placement rejects an absent locale proxy`, (t) => {
    const result = frontendFindings({ ...fixture(t, edition), files: ['apps/web/src/modules/i18n/messages/vi.json'] });
    assert.deepEqual(result.filter((finding) => finding.code === 'FE_I18N_PLACEMENT').map((finding) => finding.path), ['apps/web/src/proxy.ts']);
  });

  test(`placement accepts the locale proxy, locale routes and default catalog`, (t) => {
    const result = frontendFindings({ ...fixture(t, edition), files: ['apps/web/src/proxy.ts', 'apps/web/src/app/[locale]/page.tsx', 'apps/web/src/modules/i18n/messages/vi.json'] });
    assert.deepEqual(result.filter((finding) => finding.code === 'FE_I18N_PLACEMENT'), []);
  });

  test(`placement rejects a frontend without a next-intl workspace dependency`, (t) => {
    const result = appFrontendFindings({ ...fixture(t, edition), files: [] });
    assert.equal(result.filter((finding) => finding.code === 'FE_I18N_PLACEMENT').length, 1);
  });

  test(`placement accepts a workspace that declares next-intl`, (t) => {
    const result = appFrontendFindings({ ...fixture(t, edition), files: ['fe/apps/web/package.json'] });
    assert.deepEqual(result.filter((finding) => finding.code === 'FE_I18N_PLACEMENT'), []);
  });
}

const BASE = 'apps/web/src/';
const GROUPED = [`${BASE}proxy.ts`, `${BASE}modules/i18n/messages/vi.json`, `${BASE}app/[locale]/(pages)/loading.tsx`, `${BASE}app/[locale]/(pages)/error.tsx`, `${BASE}app/[locale]/not-found.tsx`, `${BASE}app/[locale]/[...rest]/page.tsx`];

function groupedFixture(t: TestContext, edition: string, texts: Record<string, string>) {
  const base = fixture(t, edition);
  for (const [file, text] of Object.entries(texts)) {
    const target = path.join(base.repoRoot, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  return base;
}

const CATCH_ALL = 'import { notFound } from "next/navigation"\nconst Page = (): never => notFound()\nexport default Page\n';
const NOT_FOUND = 'export { metadata as generateMetadata } from "@/x"\nexport default () => null\n';

for (const edition of ['lite'] as const) {
  test(`the loading boundary in a route group needs the notFound catch-all and the metadata of not-found`, (t) => {
    const ok = groupedFixture(t, edition, { [`${BASE}app/[locale]/[...rest]/page.tsx`]: CATCH_ALL, [`${BASE}app/[locale]/not-found.tsx`]: NOT_FOUND });
    assert.deepEqual(frontendFindings({ ...ok, files: GROUPED }).filter((finding) => finding.level === 'info' || finding.code === 'FE_ERROR_BOUNDARY_MISSING'), []);

    const noCatchAll = frontendFindings({ ...ok, files: GROUPED.filter((file) => !file.includes('[...rest]')) });
    assert.deepEqual(noCatchAll.filter((finding) => finding.code === 'FE_ERROR_BOUNDARY_MISSING').map((finding) => finding.path), [`${BASE}app/[locale]/[...rest]/page.tsx`]);

    const wrong = groupedFixture(t, edition, { [`${BASE}app/[locale]/[...rest]/page.tsx`]: 'export default () => null\n', [`${BASE}app/[locale]/not-found.tsx`]: 'export default () => null\n' });
    assert.deepEqual(frontendFindings({ ...wrong, files: GROUPED }).filter((finding) => finding.code === 'FE_ERROR_BOUNDARY_MISSING').map((finding) => finding.path),
      [`${BASE}app/[locale]/[...rest]/page.tsx`, `${BASE}app/[locale]/not-found.tsx`]);
  });

  test(`a loading boundary still at [locale] stays accepted and is reported as an info with the move`, (t) => {
    const result = frontendFindings({ ...fixture(t, edition), files: [`${BASE}proxy.ts`, `${BASE}modules/i18n/messages/vi.json`, `${BASE}app/[locale]/loading.tsx`] });
    assert.deepEqual(result.filter((finding) => finding.level === 'error'), []);
    assert.deepEqual(result.filter((finding) => finding.level === 'info').map((finding) => [finding.code, finding.path]), [['FE_I18N_PLACEMENT', `${BASE}app/[locale]/loading.tsx`]]);
  });
}
