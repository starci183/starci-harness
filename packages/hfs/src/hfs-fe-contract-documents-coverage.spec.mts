// proves: FE_GRAPHQL_CONTRACT@lite
// proves: FE_GRAPHQL_CONTRACT@full
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { feContractFindings } from '../runtime/scripts/hfs/rules/fe-contract-documents.mjs';

const CONTRACT = 'be/contracts/shop/schema.graphql';
const DOCUMENT = 'fe/apps/web/src/modules/api/graphql/product.graphql';
const SCHEMA = 'type Query { product(id: ID!): Product! }\ntype Product { id: ID!, name: String! }\n';

function check(t: TestContext, edition: string, document: string) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-document-coverage-'));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  const entries = { [CONTRACT]: SCHEMA, [DOCUMENT]: document };
  for (const [file, text] of Object.entries(entries)) {
    const target = path.join(repoRoot, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  // reason: the rule's declared context has no `repo`, yet the spec feeds it the edition it is proven in; a variable (not a literal) carries it.
  const context = { repoRoot, files: Object.keys(entries), repo: { edition } };
  return feContractFindings(context);
}

for (const edition of ['lite', 'full']) {
  test(`FE_GRAPHQL_CONTRACT (${edition}): a document selecting an undeclared field is refused`, (t) => {
    const findings = check(t, edition, 'query Product($id: ID!) { product(id: $id) { id price } }');
    assert.deepEqual(findings.map(({ code, path: file, operation, service }) => [code, file, operation, service]), [
      ['FE_GRAPHQL_CONTRACT', DOCUMENT, 'Product', 'shop'],
    ]);
    assert.match(findings[0]!.message, /price is not a field of Product/);
  });

  test(`FE_GRAPHQL_CONTRACT (${edition}): a document omitting a required argument is refused`, (t) => {
    const findings = check(t, edition, 'query Product { product { id name } }');
    assert.deepEqual(findings.map(({ code }) => code), ['FE_GRAPHQL_CONTRACT']);
    assert.match(findings[0]!.message, /omits id/);
  });

  test(`FE_GRAPHQL_CONTRACT (${edition}): a document matching its serving contract passes`, (t) => {
    assert.deepEqual(check(t, edition, 'query Product($id: ID!) { product(id: $id) { id name } }'), []);
  });
}
