import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parse, print } from 'graphql';
import type { DocumentNode } from 'graphql';
import { render } from '../sync/index.mjs';
import { INPUT_BOUNDS_VERSION, INPUT_BOUNDS_OPENAPI_EXTENSION } from '../emit/input-bounds.mjs';
import { withInputBounds } from '../emit/graphql-input-bounds.mjs';
import type { DocumentLike } from '../emit/graphql-input-bounds.mjs';

const require = createRequire(import.meta.url);

function codegenApp(t: TestContext) {
  const parent = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, 'starci-rest-form-codegen-'));
  t.after(() => {
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith('starci-rest-form-codegen-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const put = (relative: string, source: string) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
    return file;
  };
  put('package.json', JSON.stringify({ type: 'module' }));
  put('node_modules/starci-harness/package.json', JSON.stringify({ type: 'module', exports: { './input-bounds': './input-bounds.mjs' } }));
  const helper = new URL('../emit/form-bounds.mjs', import.meta.url).href;
  put('node_modules/starci-harness/input-bounds.mjs', `export { inputBoundsPlugin as plugin, openApiBoundsSource, emptyInputBoundsSource, assertCompatibleInputBounds } from ${JSON.stringify(helper)};\n`);
  const template = fs.readFileSync(new URL('../templates/app/skeleton/scripts/codegen.mjs', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  put('scripts/codegen.mjs', render(template, { appBinary: 'starci app' }));
  const exec = () => spawnSync(process.execPath, ['scripts/codegen.mjs'], { cwd: root, encoding: 'utf8' });
  const run = () => {
    const result = exec();
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };
  return { root, put, run, exec };
}

test('the app codegen generates REST form limits without GraphQL and clears removed contracts', async t => {
  const { root, put, run } = codegenApp(t);
  const rest = 'fe/apps/web/src/modules/api/rest';
  fs.mkdirSync(path.join(root, rest), { recursive: true });
  const contract = put('be/contracts/orders/openapi.json', JSON.stringify({
    openapi: '3.1.0', [INPUT_BOUNDS_OPENAPI_EXTENSION]: INPUT_BOUNDS_VERSION, components: { schemas: { CreateDto: {
      type: 'object', properties: {
        name: { type: 'string', maxLength: 40 },
        tags: { type: 'array', maxItems: 3, items: { type: 'string', maxLength: 12 } },
        count: { type: 'number', minimum: 1, maximum: 10 },
      },
    } } },
  }));
  run();
  const generated = path.join(root, rest, '__generated__/input-bounds.ts');
  const first = await import(`${pathToFileURL(generated).href}?revision=1`);
  assert.deepEqual(first.REST_INPUT_BOUNDS, { orders: { CreateDto: {
    count: { min: 1, max: 10 }, name: { maxLength: 40 }, tags: { maxItems: 3, itemMaxLength: 12 },
  } } });
  fs.unlinkSync(contract);
  run();
  const second = await import(`${pathToFileURL(generated).href}?revision=2`);
  assert.deepEqual(second.REST_INPUT_BOUNDS, {});
});

test('the app codegen clears GraphQL form limits when its contracts disappear', async t => {
  const { put, run } = codegenApp(t);
  const generated = put('fe/apps/web/src/modules/api/graphql/__generated__/input-bounds.ts',
    'export const INPUT_BOUNDS = { RemovedInput: { name: { maxLength: 200 } } } as const\n');
  run();
  const result = await import(pathToFileURL(generated).href);
  assert.deepEqual(result.INPUT_BOUNDS, {});
});

const SDL = (fields: string) => `type Query { ping: String } input CreateInput { ${fields} }`;

/** The snapshot a service emits: the SDL plus the versioned directive and the field bounds the back end carries. */
// reason: graphql's DocumentNode and the emitter's structural DocumentLike describe the same parsed document; neither is assignable to the other.
const snapshot = (sdl: string, bounds: Record<string, Record<string, Record<string, number>>>) => print(withInputBounds(parse(sdl) as unknown as DocumentLike, new Map(Object.entries(bounds).map(([type, fields]) => [type, new Map(Object.entries(fields))]))) as unknown as DocumentNode);

/** A front end whose GraphQL codegen runs for real: @graphql-codegen/cli with the client preset and the starci-harness plugin. */
function graphqlApp(t: TestContext) {
  const app = codegenApp(t);
  for (const name of ['graphql', '@graphql-codegen/cli', '@graphql-codegen/client-preset']) {
    app.put(`node_modules/${name}/package.json`, JSON.stringify({ name, main: require.resolve(name) }));
  }
  const root = 'fe/apps/web/src/modules/api/graphql';
  app.put(`${root}/queries/ping.ts`, 'import { graphql } from "../__generated__/gql"\nexport const PING = graphql(`query Ping { ping }`)\n');
  return { ...app, generated: path.join(app.root, root, '__generated__') };
}

test('the app GraphQL codegen merges service snapshots and emits their bounds beside the wire types', t => {
  const { put, run, generated } = graphqlApp(t);
  const shared = { CreateInput: { name: { maxLength: 40 }, tags: { maxItems: 3, itemMaxLength: 12 } } };
  put('be/contracts/orders/schema.graphql', snapshot(SDL('name: String! tags: [String!]!'), shared));
  put('be/contracts/billing/schema.graphql', snapshot(`${SDL('name: String! tags: [String!]!')} input InvoiceInput { note: String }`, { ...shared, InvoiceInput: { note: { maxLength: 200 } } }));
  run();
  const source = fs.readFileSync(path.join(generated, 'input-bounds.ts'), 'utf8');
  for (const expected of [/"CreateInput"/, /"maxLength": 40/, /"maxItems": 3/, /"itemMaxLength": 12/, /"InvoiceInput"/, /"maxLength": 200/, /inputBoundsIssues/]) assert.match(source, expected);
  assert.match(fs.readFileSync(path.join(generated, '.schema-sha256'), 'utf8'), /^[0-9a-f]{64}\n$/);
  assert.ok(fs.existsSync(path.join(generated, 'gql.ts')), 'the client preset still generates the wire types');
});

test('the app GraphQL codegen refuses services that state different bounds for one input and writes no stamp', t => {
  const { put, exec, generated } = graphqlApp(t);
  put('be/contracts/orders/schema.graphql', snapshot(SDL('name: String!'), { CreateInput: { name: { maxLength: 40 } } }));
  put('be/contracts/billing/schema.graphql', snapshot(SDL('name: String!'), { CreateInput: { name: { maxLength: 50 } } }));
  const result = exec();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CreateInput/);
  assert.equal(fs.existsSync(path.join(generated, '.schema-sha256')), false);
});
