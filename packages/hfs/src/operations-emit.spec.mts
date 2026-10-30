// BE-OPERATIONS-1: runtime schemas are the single source of operation wire bounds, for lite and full alike.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { z } from 'zod';
import { readOperations, openApiText } from '../emit/operations.mjs';
import { createSchemaBuilder } from '../emit/type-schema.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

const require = createRequire(import.meta.url);
// reason: the emitted wire schemas and the OpenAPI document are JSON documents; the specs probe them at arbitrary depth.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
/** What readOperations answers for a fixture whose entry file is always in the program. */
interface ReadResult { operations: Json[]; components: Record<string, Json> }
const SCHEMAS = `import { z } from 'zod'
export const InputSchema = z.strictObject({ ids: z.array(z.string().min(1).max(24)).max(5), mode: z.enum(['ready', 'all']).default('ready') })
export const OutputSchema = z.strictObject({ names: z.array(z.string().max(60)).max(5), total: z.number().int().min(0).max(5) })
`;
const CONTRACT = `import type { z } from 'zod'
interface OperationContract<Input, Output, Refusal extends string> {
 readonly kind: 'query'; readonly types?: { readonly input: Input; readonly output: Output; readonly refusal: Refusal }
}
function query<Input extends z.ZodType, Output extends z.ZodType, const Refusal extends readonly string[] = readonly []>(schemas: {input: Input; output: Output; refusal?: Refusal}): OperationContract<z.output<Input>, z.output<Output>, Refusal[number]> { throw new Error('query must not execute during emit') }
function defineOperations<Table>(table: Table): Table { throw new Error('table must not execute during emit') }
`;

function fixture(t: TestContext, { schemas = SCHEMAS, entries = `'plans.read@1': query({ input: InputSchema, output: OutputSchema, refusal: ['DENIED'] })` }: { schemas?: string; entries?: string } = {}) {
  const root = mkdtemp(t, 'hfs-operation-schemas-');
  const write = (relative: string, text: string) => {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
    return target;
  };
  write('package.json', '{}');
  write('tsconfig.json', JSON.stringify({ compilerOptions: { strict: true, skipLibCheck: true, moduleResolution: 'node', target: 'ES2022' } }));
  fs.mkdirSync(path.join(root, 'node_modules'));
  for (const name of ['zod', 'typescript']) fs.symlinkSync(path.dirname(require.resolve(`${name}/package.json`)), path.join(root, 'node_modules', name), 'junction');
  write('src/modules/platform/operations/operation.schema.ts', schemas);
  const table = `${CONTRACT}\nimport { InputSchema, OutputSchema } from './operation.schema'\nexport const OPERATIONS = defineOperations({ ${entries} })\nthrow new Error('table module must not execute during emit')\n`;
  write('src/modules/platform/operations/operations.contracts.ts', table);
  write('src/modules/platform/operations/index.ts', `export { OPERATIONS } from './operations.contracts'\n`);
  const file = write('apps/api/src/operations.ts', `export { OPERATIONS } from '../../../src/modules/platform/operations'\n`);
  return {
    root, file, write, table,
    read(): ReadResult {
      const program = ts.createProgram({ rootNames: [file], options: { strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10 } });
      // reason: the fixture entry file is always in the program, so readOperations never answers null here.
      return readOperations({ ts, program, file, repoRoot: root }) as unknown as ReadResult;
    },
  };
}

test('operation emit derives input/output bounds, defaults and closed refusals from schema exports without evaluating the app', (t) => {
  const app = fixture(t);
  const result = app.read();
  const input = z.strictObject({ ids: z.array(z.string().min(1).max(24)).max(5), mode: z.enum(['ready', 'all']).default('ready') });
  const expected: Json = z.toJSONSchema(input, { io: 'input' });
  delete expected.$schema;
  assert.deepEqual(result.operations[0].input, expected);
  assert.deepEqual(result.operations[0].refusal, ['DENIED']);
  assert.equal(result.operations[0].input.properties.ids.maxItems, 5);
  assert.equal(result.operations[0].input.properties.ids.items.maxLength, 24);
  assert.equal(result.operations[0].output.properties.names.items.maxLength, 60);
  assert.equal(result.operations[0].output.additionalProperties, false);
  const text = openApiText({ app: 'api', ...result });
  assert.equal(text, openApiText({ app: 'api', ...app.read() }));
  const openapi = JSON.parse(text);
  assert.equal(openapi.openapi, '3.1.0');
  assert.equal(openapi.components.schemas['Operation.plans.read.v1.Request'].properties.input.properties.ids.maxItems, 5);
  assert.equal(openapi.components.schemas['Operation.plans.read.v1.Request'].properties.requestId.maxLength, 128);
  assert.equal(openapi.components.schemas['Operation.plans.read.v1.Request'].additionalProperties, false);
  assert.deepEqual(openapi.components.schemas['Operation.plans.read.v1.Reply'].properties.outcome.oneOf[1].properties.code.enum, ['DENIED']);
  assert.equal(openapi.paths['/operations'].post.responses[400].content['application/json'].schema.$ref, '#/components/schemas/Operation.InvalidRequest');
  assert.equal(openapi.components.schemas['Operation.InvalidRequest'].properties.code.const, 'OPERATIONS_INVALID_REQUEST');
});

test('the app emit worker resolves schema exports through the app table and emits the same deterministic OpenAPI', (t) => {
  const app = fixture(t);
  const worker = new URL('../emit/operations-worker.mjs', import.meta.url);
  const result = spawnSync(process.execPath, [fileURLToPath(worker), app.root, 'api'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, openApiText({ app: 'api', ...app.read() }));
});

test('operation emit refuses type-only entries and schemas outside *.schema.ts with the operation id', (t) => {
  const app = fixture(t, { entries: `'plans.read@1': { kind: 'query' as const, types: undefined as {input:{id:string};output:{ok:boolean};refusal:never} | undefined }` });
  assert.throws(() => app.read(), /operation plans.read@1: input schema:.*declare input and output zod schemas/);
  app.write('src/modules/platform/operations/operation.ts', SCHEMAS);
  app.write('src/modules/platform/operations/operations.contracts.ts', `${CONTRACT}\nimport { InputSchema, OutputSchema } from './operation'\nexport const OPERATIONS = defineOperations({'plans.read@1':query({input:InputSchema,output:OutputSchema})})\n`);
  assert.throws(() => app.read(), /operation plans.read@1: input schema:.*exported declaration from \*\.schema\.ts/);
});

test('operation emit rejects non-schema dependencies and unrepresentable output instead of widening the contract', (t) => {
  const app = fixture(t, { schemas: `import fs from 'node:fs'\n${SCHEMAS}\nexport const read = fs.readFileSync\n` });
  assert.throws(() => app.read(), /operation plans.read@1: input schema:.*schema modules may import only zod/);
  app.write('src/modules/platform/operations/operation.schema.ts', SCHEMAS.replace('total: z.number().int().min(0).max(5)', 'total: z.string().max(5).transform(value => value.length)'));
  assert.throws(() => app.read(), /operation plans.read@1: output schema:.*Transforms cannot be represented/);
});

test('operation emit preserves shared schema declarations inline and refuses recursive wire values', (t) => {
  const app = fixture(t, { schemas: `import { z } from 'zod'\nconst name = z.string().max(20)\nexport const InputSchema = z.strictObject({ first: name, last: name })\nexport const OutputSchema = z.strictObject({ ok: z.boolean() })\n` });
  assert.equal(app.read().operations[0].input.properties.last.maxLength, 20);
  app.write('src/modules/platform/operations/names.schema.ts', `import { z } from 'zod'\nexport const NameSchema = z.string().max(20)\n`);
  app.write('src/modules/platform/operations/operation.schema.ts', `import { z } from 'zod'\nimport { NameSchema } from './names.schema'\nexport const InputSchema = z.strictObject({ name: NameSchema })\nexport const OutputSchema = z.strictObject({ ok: z.boolean() })\n`);
  assert.equal(app.read().operations[0].input.properties.name.maxLength, 20);
  app.write('src/modules/platform/operations/operation.schema.ts', `import { z } from 'zod'\nexport const InputSchema = z.strictObject({name: z.string().max(20)})\nexport const OutputSchema = z.strictObject({ get children() { return z.array(OutputSchema).max(3) } })\n`);
  assert.throws(() => app.read(), /operation plans.read@1: output schema:.*Cycle detected/);
});

test('operation emit accepts an empty strict schema and rejects unconstrained schemas', (t) => {
  const app = fixture(t, { schemas: `import { z } from 'zod'\nexport const InputSchema = z.strictObject({})\nexport const OutputSchema = z.strictObject({ok:z.boolean()})\n` });
  assert.deepEqual(app.read().operations[0].input, { type: 'object', properties: {}, additionalProperties: false });
  app.write('src/modules/platform/operations/operation.schema.ts', `import { z } from 'zod'\nexport const InputSchema = z.any()\nexport const OutputSchema = z.strictObject({ok:z.boolean()})\n`);
  assert.throws(() => app.read(), /operation plans.read@1: input schema:.*open schema/);
});

test('operation emit follows named entries, schema aliases, option objects and shorthand without evaluating the table', (t) => {
  const app = fixture(t);
  app.write('src/modules/platform/operations/operations.contracts.ts', `${CONTRACT}\nimport { InputSchema, OutputSchema } from './operation.schema'\nconst input = InputSchema\nconst output = OutputSchema\nconst options = {input, output}\nconst read = query(options)\nconst entries = {'plans.read@1': read}\nexport const OPERATIONS = defineOperations(entries)\nthrow new Error('do not execute table')\n`);
  assert.equal(app.read().operations[0].input.properties.ids.maxItems, 5);
  app.write('src/modules/platform/operations/operations.contracts.ts', `${CONTRACT}\nimport { InputSchema, OutputSchema } from './operation.schema'\nconst holder = {options:{input:InputSchema, output:OutputSchema}}\nconst read = query(holder.options)\nconst operations = {read}\nexport const OPERATIONS = defineOperations({'plans.read@1':operations.read})\n`);
  assert.equal(app.read().operations[0].input.properties.ids.maxItems, 5);
  app.write('src/modules/platform/operations/operations.contracts.ts', `${CONTRACT}\nimport { InputSchema as input, OutputSchema as output } from './operation.schema'\nconst options = {input, output}\nexport const OPERATIONS = defineOperations({'plans.read@1':query({...options})})\n`);
  assert.equal(app.read().operations[0].input.properties.ids.maxItems, 5);
});

test('operation emit refuses unbound refusal codes and operation ids beyond the runtime envelope bound', (t) => {
  const app = fixture(t, { entries: `'plans.read@1': query({input:InputSchema, output:OutputSchema, refusal: [] as string[]})` });
  assert.throws(() => app.read(), /operation plans.read@1: refusal must be a closed union of string literals, found string/);
  app.write('src/modules/platform/operations/operations.contracts.ts', app.table.replace('plans.read@1', `${'a'.repeat(127)}@1`).replace('refusal: [] as string[]', "refusal: ['DENIED']"));
  assert.throws(() => app.read(), /operation .*: the operation id exceeds the runtime envelope limit of 128/);
});

test('operation emit refuses bounds lost by z.toJSONSchema, including custom record refinements', (t) => {
  const app = fixture(t, { schemas: `import { z } from 'zod'\nexport const InputSchema = z.record(z.string().max(20), z.string().max(20)).refine(value => Object.keys(value).length <= 5)\nexport const OutputSchema = z.strictObject({ok:z.boolean()})\n` });
  assert.throws(() => app.read(), /operation plans.read@1: input schema:.*dictionary bound must be representable as maxProperties/);
  app.write('src/modules/platform/operations/operation.schema.ts', `import { z } from 'zod'\nexport const InputSchema = z.strictObject({ids:z.array(z.string().max(20))})\nexport const OutputSchema = z.strictObject({ok:z.boolean()})\n`);
  assert.throws(() => app.read(), /operation plans.read@1: input schema:.*array bound must be representable as maxItems/);
  app.write('src/modules/platform/operations/operation.schema.ts', `import { z } from 'zod'\nexport const InputSchema = z.strictObject({id:z.string()})\nexport const OutputSchema = z.strictObject({ok:z.boolean()})\n`);
  assert.throws(() => app.read(), /operation plans.read@1: input schema:.*string bound must be representable as maxLength/);
  app.write('src/modules/platform/operations/operation.schema.ts', `import { z } from 'zod'\nexport const InputSchema = z.tuple([z.string().max(20),z.enum(['yes','no'])])\nexport const OutputSchema = z.strictObject({ok:z.boolean()})\n`);
  assert.equal(app.read().operations[0].input.maxItems, 2);
});

test('operation emit refuses a non-strict object, publishes fixed-format maxima and keeps readOnly out of requests', (t) => {
  const OUT = 'export const OutputSchema = z.strictObject({ ok: z.boolean() })';
  const schema = (input: string, output = OUT) => ['import { z } from \'zod\'', input, output, ''].join('\n');
  const app = fixture(t, { schemas: schema('export const InputSchema = z.object({ a: z.string().max(3) })') });
  assert.throws(() => app.read(), /operation plans.read@1: input schema:.*open object.*z\.strictObject/);
  app.write('src/modules/platform/operations/operation.schema.ts', schema('export const InputSchema = z.strictObject({ id: z.uuid(), ips: z.array(z.ipv4()).max(2).readonly() })'));
  const input = app.read().operations[0].input;
  assert.equal(input.properties.id.maxLength, 36);
  assert.equal(input.properties.ips.items.maxLength, 15);
  assert.equal(input.properties.ips.readOnly, undefined);
  app.write('src/modules/platform/operations/operation.schema.ts', schema('export const InputSchema = z.strictObject({ ok: z.boolean() })', 'export const OutputSchema = z.strictObject({ items: z.array(z.string().max(4)).max(2).readonly() })'));
  assert.equal(app.read().operations[0].output.properties.items.readOnly, true);
});

for (const [parsedType, transform, reason] of [
  ['unknown', '(value): unknown => value', 'unknown'],
  ['any', '(value): any => value', 'any'],
  ['Date', 'value => new Date(value)', 'Date is not a JSON value'],
]) {
  test(`operation emit refuses a bounded wire schema whose parsed input becomes ${parsedType}`, (t) => {
    const app = fixture(t, { schemas: `import { z } from 'zod'\nexport const InputSchema = z.string().max(24).transform(${transform})\nexport const OutputSchema = z.strictObject({ok:z.boolean()})\n` });
    assert.throws(() => app.read(), (error: unknown) => (error as Error).message.startsWith(`operation plans.read@1: parsed input: ${reason}`));
  });
}

test('operation emit retains wire input bounds for a JSON-valued transform and accepts a strict empty output', (t) => {
  const app = fixture(t, { schemas: `import { z } from 'zod'\nexport const InputSchema = z.string().max(24).transform(value => value.length)\nexport const OutputSchema = z.strictObject({})\n` });
  const operation = app.read().operations[0];
  assert.equal(operation.input.type, 'string');
  assert.equal(operation.input.maxLength, 24);
  assert.deepEqual(operation.output, { type: 'object', properties: {}, additionalProperties: false });
});

test('operation emit refuses a closed output schema whose inferred parsed output is unknown', (t) => {
  const app = fixture(t, { schemas: `import { z } from 'zod'\nexport const InputSchema = z.strictObject({})\nexport const OutputSchema: z.ZodType<unknown> = z.strictObject({ok:z.boolean()})\n` });
  assert.throws(() => app.read(), /operation plans.read@1: parsed output: unknown/);
});

test('type-only schema generation still refuses empty object types without a schema-backed proof', (t) => {
  const app = fixture(t);
  const file = app.write('empty.ts', 'export type Empty = {}\nexport type EmptyRecord = { [key: string]: never }\n');
  const program = ts.createProgram({ rootNames: [file], options: { noLib: true } });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file) as ts.SourceFile;
  const type = checker.getTypeFromTypeNode((source.statements[0] as ts.TypeAliasDeclaration).type);
  assert.throws(() => createSchemaBuilder({ ts, checker }).schemaOf(type, 'input'), /input: an object type with no members and no index signature says nothing/);
  const record = checker.getTypeFromTypeNode((source.statements[1] as ts.TypeAliasDeclaration).type);
  assert.throws(() => createSchemaBuilder({ ts, checker }).schemaOf(record, 'input'), /input\[key\]: never/);
});

test('operation parsed roots cannot be undefined or void, while optional fields and defaults remain valid', (t) => {
  const app = fixture(t, { schemas: `import { z } from 'zod'\nexport const InputSchema = z.string().max(24).optional()\nexport const OutputSchema = z.strictObject({ok:z.boolean()})\n` });
  assert.throws(() => app.read(), /operation plans.read@1: parsed input: undefined is not a wire value/);
  app.write('src/modules/platform/operations/operation.schema.ts', `import { z } from 'zod'\nexport const InputSchema = z.strictObject({})\nexport const OutputSchema = z.string().max(24).optional()\n`);
  assert.throws(() => app.read(), /operation plans.read@1: parsed output: undefined is not a wire value/);
  app.write('src/modules/platform/operations/operation.schema.ts', `import { z } from 'zod'\nexport const InputSchema = z.string().max(24).transform((value): string | void => value.length ? value : undefined)\nexport const OutputSchema = z.strictObject({ok:z.boolean()})\n`);
  assert.throws(() => app.read(), /operation plans.read@1: parsed input: undefined is not a wire value/);
  app.write('src/modules/platform/operations/operation.schema.ts', `import { z } from 'zod'\nexport const InputSchema = z.strictObject({name:z.string().max(24).optional(),mode:z.enum(['ready','all']).default('ready')})\nexport const OutputSchema = z.strictObject({name:z.string().max(24).optional()})\n`);
  const operation = app.read().operations[0];
  assert.equal(operation.input.properties.name.maxLength, 24);
  assert.equal(operation.input.properties.mode.default, 'ready');
  assert.equal(operation.output.properties.name.maxLength, 24);
});
