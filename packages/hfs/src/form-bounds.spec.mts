import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSchema } from 'graphql';
import type { GraphQLSchema } from 'graphql';
import ts from 'typescript';
import { inputBoundsPlugin, openApiBoundsSource, assertCompatibleInputBounds, emptyInputBoundsSource } from '../emit/form-bounds.mjs';
import type { GraphqlSchemaLike, OpenApiSchemaLike } from '../emit/form-bounds.mjs';
import { INPUT_BOUND_ARGUMENTS, INPUT_BOUNDS_DIRECTIVE, INPUT_BOUNDS_VERSION, INPUT_BOUNDS_VERSION_ARGUMENT, INPUT_BOUNDS_OPENAPI_EXTENSION } from '../emit/input-bounds.mjs';

const directive = `directive @${INPUT_BOUNDS_DIRECTIVE}(${INPUT_BOUNDS_VERSION_ARGUMENT}: Int = ${INPUT_BOUNDS_VERSION}, ${Object.entries(INPUT_BOUND_ARGUMENTS).map(([name, type]) => `${name}: ${type}`).join(', ')}) on INPUT_FIELD_DEFINITION`;
// reason: a real GraphQLSchema is the schema the bounds read, but its astNode is Maybe<...> (may be undefined) where GraphqlSchemaLike (exactOptionalPropertyTypes) allows null only.
const asSchemaLike = (schema: GraphQLSchema): GraphqlSchemaLike => schema as unknown as GraphqlSchemaLike;
const schemaOf = (input: string): GraphqlSchemaLike => asSchemaLike(buildSchema(`${directive}\n${input}\ntype Query { ready: Boolean }`, { assumeValidSDL: true }));

// reason: the generated module is imported at run time from a data: URL, so its shape is unknown to the type system.
async function generatedBounds(schema: GraphqlSchemaLike): Promise<any> {
  return generatedModule(inputBoundsPlugin(schema));
}

// reason: the generated module is imported at run time from a data: URL, so its shape is unknown to the type system.
async function generatedModule(source: string, name: string | null = 'INPUT_BOUNDS'): Promise<any> {
  const { outputText, diagnostics } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true,
  });
  assert.deepEqual(diagnostics, []);
  const generated = await import(`data:text/javascript,${encodeURIComponent(outputText)}`);
  return name === null ? generated : generated[name];
}

test('codegen carries string, collection, numeric and each-item limits as typed values', async () => {
  const schema = schemaOf(`
    input CreateInput {
      label: String! @inputBounds(maxLength: 200)
      tags: [String!]! @inputBounds(maxItems: 5, itemMaxLength: 20)
      scores: [Float!]! @inputBounds(maxItems: 4, itemMin: -1.5, itemMax: 10)
      count: Int! @inputBounds(min: 1, max: 12)
      matrix: [[String!]] @inputBounds(maxItems: 3, itemMaxItems: 2)
      unbounded: Boolean
    }
  `);
  assert.deepEqual(await generatedBounds(schema), {
    CreateInput: {
      count: { max: 12, min: 1 }, label: { maxLength: 200 },
      matrix: { itemMaxItems: 2, maxItems: 3 }, scores: { itemMax: 10, itemMin: -1.5, maxItems: 4 },
      tags: { itemMaxLength: 20, maxItems: 5 },
    },
  });
});

test('codegen follows contract changes instead of retaining a frontend bound', async () => {
  const before = await generatedBounds(schemaOf('input KeyInput { name: String @inputBounds(maxLength: 200) }'));
  const after = await generatedBounds(schemaOf('input KeyInput { name: String @inputBounds(maxLength: 60) }'));
  assert.equal(before.KeyInput.name.maxLength, 200);
  assert.equal(after.KeyInput.name.maxLength, 60);
});

test('codegen sorts input and field names, preserves unbounded inputs and ignores output fields', async () => {
  const left = schemaOf('input Z { b: Int @inputBounds(max: 3, min: -2) a: String @inputBounds(maxLength: 7) } input A { x: String }');
  const right = schemaOf('input A { x: String } input Z { a: String @inputBounds(maxLength: 7) b: Int @inputBounds(min: -2, max: 3) }');
  assert.equal(inputBoundsPlugin(left), inputBoundsPlugin(right));
  assert.deepEqual((await generatedBounds(left)).A, {});
  assert.deepEqual(await generatedBounds(schemaOf('type Output { x: String }')), {});
});

const MALFORMED_ARGUMENTS: Array<[string, RegExp]> = [
  ['maxLength: -1', /invalid input bound maxLength/],
  ['maxLength: 1.5', /invalid input bound maxLength/],
  ['max: "3"', /invalid input bound max/],
  ['max: 1e999', /invalid input bound max/],
  ['unknown: 3', /invalid input bound unknown/],
  ['max: 3, max: 2', /duplicate input bound max/],
];
for (const [argumentsText, message] of MALFORMED_ARGUMENTS) {
  test(`codegen refuses malformed contract arguments (${argumentsText})`, () => {
    const schema = schemaOf(`input Broken { field: String @inputBounds(${argumentsText}) }`);
    assert.throws(() => inputBoundsPlugin(schema), message);
  });
}

test('codegen refuses empty and repeated bounds directives', () => {
  assert.throws(() => inputBoundsPlugin(schemaOf('input Broken { field: String @inputBounds }')), /empty inputBounds/);
  assert.throws(() => inputBoundsPlugin(schemaOf('input Broken { field: String @inputBounds(maxLength: 3) @inputBounds(maxLength: 2) }')), /duplicate inputBounds/);
});

interface OpenApiDocument {
  openapi: string;
  components: { schemas: Record<string, OpenApiSchemaLike> };
  [extension: string]: unknown;
}
const openApi = (properties: Record<string, OpenApiSchemaLike>): OpenApiDocument => ({ openapi: '3.1.0', [INPUT_BOUNDS_OPENAPI_EXTENSION]: INPUT_BOUNDS_VERSION, components: { schemas: { CreateDto: { type: 'object', properties } } } });

test('REST codegen reads nullable, collection, item and numeric limits, scoped to each service', async () => {
  const api = openApi({
    name: { type: 'string', maxLength: 60 },
    tags: { type: 'array', maxItems: 3, items: { type: 'string', maxLength: 12 } },
    count: { anyOf: [{ type: 'null' }, { type: 'number', minimum: -2.5, maximum: 8 }] },
    other: { $ref: '#/components/schemas/Text' },
    scores: { type: 'array', items: { type: 'number', minimum: 1, maximum: 9 } },
  });
  api.components.schemas.Text = { type: 'string', maxLength: 10 };
  const source = openApiBoundsSource({ api, second: openApi({ name: { type: 'string', maxLength: 40 } }) });
  assert.deepEqual(await generatedModule(source, 'REST_INPUT_BOUNDS'), {
    api: { CreateDto: {
      count: { max: 8, min: -2.5 }, name: { maxLength: 60 }, other: { maxLength: 10 },
      scores: { itemMax: 9, itemMin: 1 }, tags: { itemMaxLength: 12, maxItems: 3 },
    } },
    second: { CreateDto: { name: { maxLength: 40 } } },
  });
});

test('GraphQL services cannot merge conflicting bounds and removed schemas clear generated limits', async () => {
  const first = schemaOf('input KeyInput { name: String @inputBounds(maxLength: 60) }');
  const same = schemaOf('input KeyInput { name: String @inputBounds(maxLength: 60) }');
  const wider = schemaOf('input KeyInput { name: String @inputBounds(maxLength: 200) }');
  const unbounded = schemaOf('input KeyInput { name: String }');
  assert.doesNotThrow(() => assertCompatibleInputBounds({ first, same }));
  assert.throws(() => assertCompatibleInputBounds({ first, wider }), /conflicting input bounds for KeyInput.name/);
  assert.throws(() => assertCompatibleInputBounds({ first, unbounded }), /conflicting input bounds for KeyInput.name/);
  assert.deepEqual(await generatedModule(emptyInputBoundsSource()), {});
});

test('REST codegen refreshes changed bounds, clears removed contracts and refuses malformed contracts', async () => {
  const first = openApiBoundsSource({ api: openApi({ name: { type: 'string', maxLength: 60 } }) });
  const second = openApiBoundsSource({ api: openApi({ name: { type: 'string', maxLength: 20 } }) });
  assert.equal((await generatedModule(first, 'REST_INPUT_BOUNDS')).api.CreateDto.name.maxLength, 60);
  assert.equal((await generatedModule(second, 'REST_INPUT_BOUNDS')).api.CreateDto.name.maxLength, 20);
  assert.deepEqual(await generatedModule(openApiBoundsSource({}), 'REST_INPUT_BOUNDS'), {});
  assert.throws(() => openApiBoundsSource({ api: {} }), /expected an emitted OpenAPI/);
  assert.throws(() => openApiBoundsSource({ api: openApi({ name: { maxLength: -1 } }) }), /invalid OpenAPI input bound/);
  assert.throws(() => openApiBoundsSource({ api: openApi({ name: { $ref: '#/components/schemas/Missing' } }) }), /unresolved OpenAPI/);
});

test('the generated reader enforces every scalar, collection and each-item bound with field paths', async () => {
  const generated = await generatedModule(inputBoundsPlugin(schemaOf(`input CreateInput {
    label: String @inputBounds(maxLength: 3)
    tags: [String!] @inputBounds(maxItems: 2, itemMaxLength: 3)
    count: Float @inputBounds(min: -2.5, max: 8)
    scores: [Float!] @inputBounds(maxItems: 2, itemMin: 1, itemMax: 9)
    matrix: [[String!]] @inputBounds(maxItems: 2, itemMaxItems: 2)
  }`)), null);
  const bounds = generated.INPUT_BOUNDS.CreateInput;
  const valid = { label: 'abc', tags: ['abc'], count: -2.5, scores: [1, 9], matrix: [['a', 'b']] };
  assert.deepEqual(generated.inputBoundsIssues(bounds, valid), []);
  assert.deepEqual(generated.inputBoundsIssues(bounds, { ...valid, count: 8 }), []);
  assert.deepEqual(generated.inputBoundsIssues(bounds, {
    label: 'abcd', tags: ['abcd'], count: 8.1, scores: [0, 10], matrix: [['a', 'b', 'c']],
  }), [
    { path: ['count'], kind: 'max', bound: 8 },
    { path: ['label'], kind: 'maxLength', bound: 3 },
    { path: ['matrix', 0], kind: 'maxItems', bound: 2 },
    { path: ['scores', 0], kind: 'min', bound: 1 },
    { path: ['scores', 1], kind: 'max', bound: 9 },
    { path: ['tags', 0], kind: 'maxLength', bound: 3 },
  ]);
  assert.deepEqual(generated.inputBoundsIssues(bounds, { ...valid, tags: ['long', 'long', 'long'] }), [
    { path: ['tags'], kind: 'maxItems', bound: 2 },
  ]);
  assert.deepEqual(generated.inputBoundsIssues(bounds, { ...valid, count: -2.6 }), [
    { path: ['count'], kind: 'min', bound: -2.5 },
  ]);
  assert.equal(generated.inputBoundsIssues(bounds, { ...valid, count: Number.NaN }).length, 2);
  assert.deepEqual(generated.inputBoundsIssues(bounds, {}), []);
});

test('adding a backend bound applies automatically to an existing form without a new frontend check', async () => {
  const before = await generatedModule(inputBoundsPlugin(schemaOf('input ExistingInput { count: Float }')), null);
  const after = await generatedModule(inputBoundsPlugin(schemaOf('input ExistingInput { count: Float @inputBounds(max: 10) }')), null);
  // reason: `module` is a generated module imported at run time.
  const validate = (module: any, values: unknown) => module.inputBoundsIssues(module.INPUT_BOUNDS.ExistingInput, values);
  assert.deepEqual(validate(before, { count: 11 }), []);
  assert.deepEqual(validate(after, { count: 11 }), [{ path: ['count'], kind: 'max', bound: 10 }]);
  const restBefore = await generatedModule(openApiBoundsSource({ api: openApi({ count: { type: 'number' } }) }), null);
  const restAfter = await generatedModule(openApiBoundsSource({ api: openApi({ count: { type: 'number', maximum: 10 } }) }), null);
  assert.deepEqual(restBefore.inputBoundsIssues(restBefore.REST_INPUT_BOUNDS.api.CreateDto, { count: 11 }), []);
  assert.deepEqual(restAfter.inputBoundsIssues(restAfter.REST_INPUT_BOUNDS.api.CreateDto, { count: 11 }), [
    { path: ['count'], kind: 'max', bound: 10 },
  ]);
});

test('REST tuple item bounds reach the generated reader through prefixItems', async () => {
  const generated = await generatedModule(openApiBoundsSource({ api: openApi({ coordinates: {
    type: 'array', minItems: 2, maxItems: 2,
    prefixItems: [{ type: 'number', minimum: 0, maximum: 1 }, { type: 'number', minimum: 0, maximum: 1 }],
  } }) }), null);
  const bounds = generated.REST_INPUT_BOUNDS.api.CreateDto;
  assert.deepEqual(bounds.coordinates, { itemMax: 1, itemMin: 0, maxItems: 2 });
  assert.deepEqual(generated.inputBoundsIssues(bounds, { coordinates: [0, 1] }), []);
  assert.deepEqual(generated.inputBoundsIssues(bounds, { coordinates: [-0.1, 1.1] }), [
    { path: ['coordinates', 0], kind: 'min', bound: 0 },
    { path: ['coordinates', 1], kind: 'max', bound: 1 },
  ]);
});

test('codegen refuses legacy and unsupported contract formats instead of assuming empty bounds', () => {
  const legacy = asSchemaLike(buildSchema('input ExistingInput { count: Float } type Query { ready: Boolean }'));
  assert.throws(() => inputBoundsPlugin(legacy), /input-bounds metadata; run starci app emit/);
  assert.throws(() => assertCompatibleInputBounds({ legacy }), /legacy: missing or unsupported/);
  const unsupported = asSchemaLike(buildSchema(`${directive.replace(`= ${INPUT_BOUNDS_VERSION},`, `= ${INPUT_BOUNDS_VERSION + 1},`)} input ExistingInput { count:Float } type Query { ready:Boolean }`));
  assert.throws(() => inputBoundsPlugin(unsupported), /unsupported input-bounds metadata/);
  const rest = openApi({ count: { type: 'number' } });
  delete rest[INPUT_BOUNDS_OPENAPI_EXTENSION];
  assert.throws(() => openApiBoundsSource({ api: rest }), /input-bounds metadata; run starci app emit/);
  rest[INPUT_BOUNDS_OPENAPI_EXTENSION] = INPUT_BOUNDS_VERSION + 1;
  assert.throws(() => openApiBoundsSource({ api: rest }), /unsupported input-bounds metadata/);
});

test('explicit supported field versions are accepted and mixed versions refuse generation', async () => {
  const current = schemaOf(`input KeyInput { name:String @inputBounds(version:${INPUT_BOUNDS_VERSION}, maxLength:3) }`);
  assert.deepEqual(await generatedBounds(current), { KeyInput: { name: { maxLength: 3 } } });
  const mixed = schemaOf(`input KeyInput { name:String @inputBounds(version:${INPUT_BOUNDS_VERSION + 1}, maxLength:3) }`);
  assert.throws(() => inputBoundsPlugin(mixed), /unsupported input-bounds version/);
});
