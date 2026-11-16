// proves: FE_I18N_LOCALE_MISSING@lite
// proves: FE_I18N_LOCALE_MISSING@full
// R60 FE_I18N_LOCALE_MISSING: every locale an app's defineI18n declares has its catalog, and every catalog is a declared locale.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localeCatalogFindings } from '../runtime/scripts/hfs/rules/i18n-locales.mjs';

const repo = { profile: 'fe', apps: [{ name: 'web', kind: 'next' }] };
const I18N = 'apps/web/src/modules/i18n';
const routing = (locales: string) => `import { defineI18n } from "@starci/next-i18n"\n${locales}\nexport const i18n = defineI18n({\n    locales: LOCALES,\n    defaultLocale: "vi",\n    localePrefix: "never",\n})\n`;

/** The R60 locale findings of an fe side holding `files` ({ side-relative path: text }). */
function judge(t: TestContext, files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-r60-locales-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return localeCatalogFindings({ repoRoot: root, files: Object.keys(files), repo });
}

for (const edition of ['lite', 'full']) {
  test(`FE_I18N_LOCALE_MISSING@${edition}: a declared locale without its catalog and a catalog of an undeclared locale are violations, report-only in --env local`, (t) => {
    const findings = judge(t, {
      [`${I18N}/routing.ts`]: routing('const LOCALES = ["vi", "en"] as const'),
      [`${I18N}/messages/vi.json`]: '{ "home": { "title": "Trang chủ" } }',
      [`${I18N}/messages/ja.json`]: '{ "home": { "title": "ホーム" } }',
    });
    assert.deepEqual(findings.map(({ code, path: file, locale, local }) => [code, file, locale, local]), [
      ['FE_I18N_LOCALE_MISSING', `${I18N}/messages/en.json`, 'en', true],
      ['FE_I18N_LOCALE_MISSING', `${I18N}/messages/ja.json`, 'ja', true],
    ]);
    assert.match(findings[0]!.message, /declares the locale en/);
    assert.match(findings[1]!.message, /does not declare in defineI18n/);
  });

  test(`FE_I18N_LOCALE_MISSING@${edition}: one catalog per declared locale passes, inline or through a const; a computed list is not judged`, (t) => {
    const catalogs = { [`${I18N}/messages/vi.json`]: '{}', [`${I18N}/messages/en.json`]: '{}' };
    assert.deepEqual(judge(t, { [`${I18N}/routing.ts`]: routing('const LOCALES = ["vi", "en"] as const'), ...catalogs }), []);
    assert.deepEqual(judge(t, { [`${I18N}/routing.ts`]: routing('').replace('locales: LOCALES', 'locales: ["vi", "en"] satisfies ReadonlyArray<string>'), ...catalogs }), []);
    assert.deepEqual(judge(t, { [`${I18N}/routing.ts`]: routing('const LOCALES = [...BASE, "en"] as const'), [`${I18N}/messages/vi.json`]: '{}' }), []);
  });
}
