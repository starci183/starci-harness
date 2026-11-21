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
for (const edition of ['lite'] as const) {
  test(`a loading boundary still at [locale] stays accepted and is reported as an info with the move`, (t) => {
    const result = frontendFindings({ ...fixture(t, edition), files: [`${BASE}proxy.ts`, `${BASE}modules/i18n/messages/vi.json`, `${BASE}app/[locale]/loading.tsx`] });
    assert.deepEqual(result.filter((finding) => finding.level === 'error'), []);
    assert.deepEqual(result.filter((finding) => finding.level === 'info').map((finding) => [finding.code, finding.path]), [['FE_I18N_PLACEMENT', `${BASE}app/[locale]/loading.tsx`]]);
  });
}
