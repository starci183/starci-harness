// proves: BE_FAILURE_CLASS_BY_TEXT@lite
// proves: BE_FAILURE_CLASS_BY_TEXT@full
// proves: HFS_CONCEPT_CONVENTIONS_MISSING@lite
// proves: HFS_CONCEPT_CONVENTIONS_MISSING@full
/** R432 (a failure's class is never read from its code text) and R433 (every app keeps a conventions concept its catalog links), on real files. */
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
    const { root, files } = tree(t, Object.fromEntries(['README.md', 'conventions.md'].map((name) => [`.starciwork/concepts/${name}`, fs.readFileSync(path.join(skeleton, name), 'utf8')])));
    assert.deepEqual(conceptConventionsFindings({ repoRoot: root, files }), []);
  });
}
