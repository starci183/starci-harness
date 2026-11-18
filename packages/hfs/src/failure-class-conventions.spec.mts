// proves: BE_FAILURE_CLASS_BY_TEXT@lite
// proves: BE_FAILURE_CLASS_BY_TEXT@full
// proves: HFS_CONCEPT_CONVENTIONS_MISSING@lite
// proves: HFS_CONCEPT_CONVENTIONS_MISSING@full
// proves: HFS_CONCEPT_UNCATALOGUED@lite
// proves: HFS_CONCEPT_UNCATALOGUED@full
/** R432 (a failure's class is never read from its code text) and R433 (every app keeps a conventions concept its catalog links, and one catalog row per concept), on real files. */
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { failureClassFindings } from '../runtime/scripts/hfs/rules/failure-class.mjs';
import { conceptConventionsFindings } from '../runtime/scripts/hfs/rules/concepts-conventions.mjs';

const TEMPLATES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'app');

function tree(t: TestContext, files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-proof-r432-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return { root, files: Object.keys(files) };
}

for (const edition of ['lite', 'full']) {
  test(`BE_FAILURE_CLASS_BY_TEXT@${edition} refuses a back-end source that matches a failure code text, as a literal or a pattern`, (t) => {
    const { root, files } = tree(t, {
      'src/modules/platform/retry/transient.ts': 'export const isTransient = (error: { code?: string }) => error.code === "ECONNRESET" || error.code === \'40001\'\n',
      'src/modules/domain/orders/orders.service.ts': 'const retryable = /ETIMEDOUT|timeout/i\nexport const again = (message: string) => retryable.test(message)\n',
    });
    const findings = failureClassFindings({ repoRoot: root, files });
    assert.deepEqual(findings.map(({ path: file, line, text }) => [file, line, text]), [
      ['src/modules/platform/retry/transient.ts', 1, 'ECONNRESET'],
      ['src/modules/domain/orders/orders.service.ts', 1, 'ETIMEDOUT'],
    ]);
    assert.match(String(findings[0]?.message), /explicit failureClass/);
  });

  test(`BE_FAILURE_CLASS_BY_TEXT@${edition} reads a regex literal full of \\u escapes in linear time, and still finds a code in one`, (t) => {
    const escapes = Array.from({ length: 52 }, (_, index) => `\\u${(0x1ea0 + index).toString(16)}`).join('');
    const vietnamese = `const VIETNAMESE = /[a-z${escapes}]+(?:\\s+[a-z${escapes}]+)*$/iu\n`;
    const { root, files } = tree(t, {
      'src/modules/domain/brain/extraction.policy.ts': vietnamese.repeat(3),
      'src/modules/domain/brain/retry.policy.ts': `const retryable = /[${escapes}]*ETIMEDOUT/u\n`,
    });
    const started = performance.now();
    const findings = failureClassFindings({ repoRoot: root, files });
    assert.ok(performance.now() - started < 1000, 'the rule reads an escape-heavy line in linear time');
    assert.deepEqual(findings.map(({ path: file, text }) => [file, text]), [['src/modules/domain/brain/retry.policy.ts', 'ETIMEDOUT']]);
  });

  test(`BE_FAILURE_CLASS_BY_TEXT@${edition} accepts an explicit failureClass, a comment, a spec and a word that only contains a code`, (t) => {
    const { root, files } = tree(t, {
      'src/modules/integrations/mail/mail.client.ts': '// a dropped connection (ECONNRESET) is transient: the judge decides\nexport class MailDown extends Error { readonly failureClass = "transient" }\nexport const label = "ECONNRESET_COUNT"\n',
      'src/modules/integrations/mail/mail.client.spec.ts': 'const error = Object.assign(new Error("x"), { code: "ECONNRESET" })\n',
    });
    assert.deepEqual(failureClassFindings({ repoRoot: root, files }), []);
  });

  test(`HFS_CONCEPT_CONVENTIONS_MISSING@${edition} refuses an app without the conventions concept or its catalog row`, (t) => {
    const { root, files } = tree(t, { '.starciwork/concepts/README.md': '| Concept | Read when you touch (folders) | One line |\n| --- | --- | --- |\n| [orders](orders.md) | `be/src/` | Orders. |\n', '.starciwork/concepts/orders.md': '# Orders\n' });
    assert.deepEqual(conceptConventionsFindings({ repoRoot: root, files }).map(({ path: file }) => file), ['.starciwork/concepts/conventions.md', '.starciwork/concepts/README.md']);
  });

  test(`HFS_CONCEPT_CONVENTIONS_MISSING@${edition} accepts the concept the scaffold renders`, (t) => {
    const skeleton = path.join(TEMPLATES, edition === 'lite' ? 'skeleton-lite' : 'skeleton', '.starciwork', 'concepts');
    const { root, files } = tree(t, Object.fromEntries(fs.readdirSync(skeleton).map((name) => [`.starciwork/concepts/${name}`, fs.readFileSync(path.join(skeleton, name), 'utf8')])));
    assert.deepEqual(conceptConventionsFindings({ repoRoot: root, files }), []);
  });

  const CATALOG = (rows: string) => `| Concept | Read when you touch (folders) | One line |\n| --- | --- | --- |\n| [conventions](conventions.md) | \`be/src/\` | Conventions. |\n${rows}`;

  test(`HFS_CONCEPT_UNCATALOGUED@${edition} refuses a concept no catalog row links and a row whose concept is not tracked, report-only in --env local`, (t) => {
    const { root, files } = tree(t, {
      '.starciwork/concepts/README.md': CATALOG('| [orders](orders.md) | `be/src/modules/domain/orders/` | Orders. |\n| [billing](./billing.md) | `be/src/modules/domain/billing/` | Billing. |\n'),
      '.starciwork/concepts/conventions.md': '# Conventions\n',
      '.starciwork/concepts/orders.md': '# Orders\n',
      '.starciwork/concepts/payments.md': '# Payments\n',
    });
    const findings = conceptConventionsFindings({ repoRoot: root, files });
    assert.deepEqual(findings.map(({ code, path: file, local }) => [code, file, local]), [
      ['HFS_CONCEPT_UNCATALOGUED', '.starciwork/concepts/payments.md', true],
      ['HFS_CONCEPT_UNCATALOGUED', '.starciwork/concepts/README.md', true],
    ]);
    assert.match(String(findings[0]?.message), /\| \[payments\]\(payments\.md\) \|/u);
    assert.match(String(findings[1]?.message), /linking billing\.md/u);
  });

  test(`HFS_CONCEPT_UNCATALOGUED@${edition} accepts one row per concept and a legacy concept record, and leaves a missing catalog to R433`, (t) => {
    const passing = tree(t, {
      '.starciwork/concepts/README.md': CATALOG('| [orders](./orders.md) | `be/src/modules/domain/orders/` | Orders. |\n'),
      '.starciwork/concepts/conventions.md': '# Conventions\n',
      '.starciwork/concepts/orders.md': '# Orders\n',
      '.starciwork/concepts/legacy/index.yaml': 'schema: work/concept@1\n',
    });
    assert.deepEqual(conceptConventionsFindings({ repoRoot: passing.root, files: passing.files }), []);
    const bare = tree(t, { '.starciwork/concepts/conventions.md': '# Conventions\n', '.starciwork/concepts/orders.md': '# Orders\n' });
    assert.deepEqual(conceptConventionsFindings({ repoRoot: bare.root, files: bare.files }).map(({ code }) => code), ['HFS_CONCEPT_CONVENTIONS_MISSING']);
  });
}
