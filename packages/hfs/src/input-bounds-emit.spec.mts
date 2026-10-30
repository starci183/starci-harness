/** Backend bounds reach the emitted contracts and contract drift judgment without executing app bootstrap code. */
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { buildSchema, parse, print } from 'graphql';
import type { DocumentNode, GraphQLInputField, GraphQLInputObjectType, GraphQLSchema } from 'graphql';
import { emitContracts } from '../emit/contracts.mjs';
import { boundsOf, INPUT_BOUNDS_DIRECTIVE, INPUT_BOUNDS_OPENAPI_EXTENSION, INPUT_BOUNDS_VERSION, INPUT_BOUNDS_VERSION_ARGUMENT } from '../emit/input-bounds.mjs';
import { graphqlInputBounds, withInputBounds } from '../emit/graphql-input-bounds.mjs';
import type { DocumentLike, InputBoundsMap } from '../emit/graphql-input-bounds.mjs';
import { readOperations, openApiText } from '../emit/operations.mjs';
import { inputBoundsPlugin } from '../emit/form-bounds.mjs';
import { contractEmitFindings } from '../runtime/scripts/hfs/rules/contract.mjs';

// reason: schemas read back from the emitted OpenAPI contract and the operation reader are JSON trees whose members the assertions judge.
type Json = any;
type Put = (relative: string, text: string) => void;
interface Read { operations: Json[]; components: Json }
interface BoundValidator { name: string; constraints?: unknown[]; each?: boolean; propertyName: string }
type BoundValidators = BoundValidator[];

// reason: graphql's DocumentNode and the emitter's structural DocumentLike describe the same parsed document; neither is assignable to the other.
const withBounds = (document: DocumentNode, bounds: InputBoundsMap): DocumentNode => withInputBounds(document as unknown as DocumentLike, bounds) as unknown as DocumentNode;
const inputFields = (schema: GraphQLSchema, name: string) => (schema.getType(name) as GraphQLInputObjectType).getFields();

const require = createRequire(import.meta.url);
const BOUNDS = new Map([['CreateInput', new Map([['name', { maxLength: 60 }]])]]);

function fixture(t: TestContext, files: Record<string, string>) {
  const parent = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, 'starci-input-bounds-'));
  t.after(() => {
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith('starci-input-bounds-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const put: Put = (relative, text) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  for (const [file, text] of Object.entries(files)) put(file, text);
  return { root, put };
}

function dependency(put: Put, name: string, typed = false) {
  const manifest: { types?: string } = typed ? require(`${name}/package.json`) : {};
  put(`node_modules/${name}/package.json`, JSON.stringify({
    name, main: require.resolve(name),
    ...(manifest.types ? { types: path.resolve(path.dirname(require.resolve(`${name}/package.json`)), manifest.types) } : {}),
  }));
}

const SCHEMA_HOME = 'src/modules/domain/inputs';
const TABLE = `
import type { z } from 'zod';
import { InputSchema, OutputSchema } from './input.schema';
declare function mutation<I extends z.ZodType, O extends z.ZodType>(schemas: {input:I; output:O}): {kind:'mutation';types: {input:z.output<I>; output:z.output<O>; refusal:never}};
declare function defineOperations<T>(table:T):T;
export const OPERATIONS = defineOperations({ 'create@1': mutation({input:InputSchema, output:OutputSchema}) });
throw new Error('the operation table must not execute during emit');
`;
const OUTPUT = 'export const OutputSchema = z.strictObject({ id:z.string().max(36) });';

function operationFiles(put: Put, source: string, extra: Record<string, string> = {}) {
  put(`${SCHEMA_HOME}/input.schema.ts`, source);
  put(`${SCHEMA_HOME}/inputs-operations.contracts.ts`, TABLE);
  put('apps/api/src/operations.ts', `export { OPERATIONS } from '../../../${SCHEMA_HOME}/inputs-operations.contracts';`);
  for (const [name, text] of Object.entries(extra)) put(`${SCHEMA_HOME}/${name}`, text);
  dependency(put, 'zod', true);
}

function operations(t: TestContext, source: string, extra: Record<string, string> = {}): Read {
  const { root, put } = fixture(t, { 'package.json': '{}' });
  operationFiles(put, source, extra);
  const file = path.join(root, 'apps/api/src/operations.ts');
  const program = ts.createProgram([file], {
    strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10, experimentalDecorators: true,
  });
  return readOperations({ ts, program, file, repoRoot: root }) as unknown as Read;
}

test('OpenAPI emits imported schema constants, extended fields, nullable numbers and item constraints', t => {
  const result = operations(t, `
import { z } from 'zod';
import { NAME_LIMIT } from './limits.schema';
const BaseSchema = z.strictObject({ name:z.string().max(NAME_LIMIT) });
export const InputSchema = BaseSchema.extend({
  tags:z.array(z.string().max(12)).max(3),
  count:z.number().min(-2.5).max(8).nullish(),
  title:z.string().max(5),
});
${OUTPUT}`, { 'limits.schema.ts': 'export const NAME_LIMIT = 30 * 2;' });
  const input = result.operations[0].input;
  assert.equal(input.additionalProperties, false);
  assert.deepEqual(input.properties.name, { type: 'string', maxLength: 60 });
  assert.deepEqual(input.properties.tags, { type: 'array', maxItems: 3, items: { type: 'string', maxLength: 12 } });
  assert.deepEqual(input.properties.title, { type: 'string', maxLength: 5 });
  const count = input.properties.count.anyOf;
  assert.ok(count.some((part: Json) => part.type === 'null'));
  assert.ok(count.some((part: Json) => part.type === 'number' && part.minimum === -2.5 && part.maximum === 8));
  assert.equal(input.required.includes('count'), false);
  const openapi = JSON.parse(openApiText({ app: 'api', ...result }));
  assert.deepEqual(openapi.components.schemas['Operation.create.v1.Request'].properties.input, input);
  assert.equal(openapi[INPUT_BOUNDS_OPENAPI_EXTENSION], INPUT_BOUNDS_VERSION);
});

test('OpenAPI follows namespace schema imports', t => {
  const result = operations(t, `
import * as schema from './names.schema';
export const InputSchema = schema.InputSchema;
export const OutputSchema = schema.OutputSchema;
`, { 'names.schema.ts': `import { z } from 'zod'; export const InputSchema = z.strictObject({name:z.string().max(20)}); ${OUTPUT}` });
  assert.equal(result.operations[0].input.properties.name.maxLength, 20);
});

test('OpenAPI follows barrel schema aliases and keeps bounds on extended fields', t => {
  const result = operations(t, `
import { z } from 'zod';
import { BaseSchema as Base } from './barrel.schema';
export const InputSchema = Base.extend({});
${OUTPUT}`, {
    'barrel.schema.ts': "export { NameSchema as BaseSchema } from './names.schema';",
    'names.schema.ts': "import {z} from 'zod'; export const NameSchema = z.strictObject({name:z.string().max(60)});",
  });
  assert.equal(result.operations[0].input.properties.name.maxLength, 60);
});

test('OpenAPI carries numeric bounds on every declared tuple member', t => {
  const result = operations(t, `
import {z} from 'zod';
const Coordinate = z.number().min(0).max(1);
export const InputSchema = z.strictObject({coords:z.tuple([Coordinate, Coordinate])});
${OUTPUT}`);
  assert.deepEqual(result.operations[0].input.properties.coords, {
    type: 'array', minItems: 2, maxItems: 2, items: false,
    prefixItems: [{ type: 'number', minimum: 0, maximum: 1 }, { type: 'number', minimum: 0, maximum: 1 }],
  });
});

test('OpenAPI refuses unresolved schema bounds and bounds missing from the wire contract', t => {
  assert.throws(() => operations(t, `import {z} from 'zod'; declare function getLimit():number; export const InputSchema = z.strictObject({name:z.string().max(getLimit())}); ${OUTPUT}`), /operation create@1: input schema: getLimit is not defined/);
  for (const [schema, reason] of [
    ['z.string().refine(value => value.length <= 20)', /input\.name:.*maxLength/],
    ['z.array(z.string().max(20)).refine(value => value.length <= 3)', /input\.name:.*maxItems/],
    ['z.array(z.string()).max(3)', /input\.name\[\]:.*maxLength/],
  ] as Array<[string, RegExp]>) {
    assert.throws(() => operations(t, `import {z} from 'zod'; export const InputSchema = z.strictObject({name:${schema}}); ${OUTPUT}`), (error: Error) => error.message.startsWith('operation create@1: input schema: ') && reason.test(error.message));
  }
});

test('bounds intersect repeated validators and reject invalid numbers and inverted ranges', () => {
  assert.deepEqual(boundsOf([
    { name: 'maxLength', constraints: [200] }, { name: 'maxLength', constraints: [60] },
    { name: 'min', constraints: [1] }, { name: 'min', constraints: [2] },
    { name: 'maxLength', constraints: [10], each: true },
    { name: 'isOptional' },
    { name: 'constructor' },
  ], 'Input.name'), { maxLength: 60, min: 2, itemMaxLength: 10 });
  for (const name of ['maxLength', 'arrayMaxSize']) {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) assert.throws(() => boundsOf([{ name, constraints: [value] }], 'Input.name'), /Input.name:/);
  }
  assert.throws(() => boundsOf([{ name: 'min', constraints: [4] }, { name: 'max', constraints: [2] }], 'Input.count'), /min exceeds max/);
  assert.deepEqual(boundsOf([{ name: 'constructor' }], 'Input.name'), {});
});

test('GraphQL directive carries its format version and query-only documents keep their identity', () => {
  const queryOnly = parse('type Query { ping:String }');
  assert.equal(withBounds(queryOnly, new Map()), queryOnly);
  const document = parse('input CreateInput { name:String! } type Query { ping:String }');
  const output = print(withBounds(document, BOUNDS));
  const schema = buildSchema(output);
  assert.equal(schema.getDirective(INPUT_BOUNDS_DIRECTIVE)?.args.find((argument) => argument.name === INPUT_BOUNDS_VERSION_ARGUMENT)?.defaultValue, INPUT_BOUNDS_VERSION);
  const directive = inputFields(schema, 'CreateInput').name?.astNode?.directives?.[0];
  assert.equal(directive?.name.value, 'inputBounds');
  assert.equal((directive?.arguments?.[0]?.value as { value?: string } | undefined)?.value, '60');
  assert.throws(() => withBounds(parse('directive @inputBounds on INPUT_FIELD_DEFINITION input CreateInput { name:String }'), BOUNDS), /reserved/);
  assert.throws(() => withBounds(document, new Map([['CreateInput', new Map([['name', { maxLength: 2147483648 }]])]])), /exceeds GraphQL Int/);
  const unbounded = buildSchema(print(withBounds(parse('input NumericInput { count:Float } type Query { ping:String }'), new Map())));
  assert.equal(unbounded.getDirective(INPUT_BOUNDS_DIRECTIVE)?.args.find((argument) => argument.name === INPUT_BOUNDS_VERSION_ARGUMENT)?.defaultValue, INPUT_BOUNDS_VERSION);
  assert.deepEqual(inputFields(unbounded, 'NumericInput').count?.astNode?.directives, []);
});

test('GraphQL refuses ambiguous input names and scalar/list validator mismatches', () => {
  class Input {}
  class OtherInput {}
  const schema = buildSchema('input CreateInput { name:String tags:[String!] count:Float } type Query { ping:String }');
  const properties = ['name', 'tags', 'count'].map(name => ({ name, schemaName: name }));
  const metadata = [{ name: 'CreateInput', target: Input, properties }];
  const typeStorage = { getInputTypesMetadata: () => metadata };
  const run = (validators: BoundValidators) => graphqlInputBounds({ schema, typeStorage, validationStorage: { getTargetValidationMetadatas: () => validators } });
  for (const validator of [
    { name: 'maxLength', constraints: [10], each: true, propertyName: 'name' },
    { name: 'maxLength', constraints: [10], propertyName: 'tags' },
    { name: 'arrayMaxSize', constraints: [10], each: true, propertyName: 'tags' },
    { name: 'min', constraints: [10], propertyName: 'name' },
    { name: 'maxLength', constraints: [10], propertyName: 'count' },
  ]) assert.throws(() => run([validator]), /CreateInput\./);
  metadata.push({ name: 'CreateInput', target: OtherInput, properties });
  assert.throws(() => run([]), /duplicate backend input type name/);
});

function workerFixture(t: TestContext, { validator = true, resolver }: { validator?: boolean; resolver?: string } = {}) {
  const files = {
    'package.json': '{}',
    'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'commonjs', experimentalDecorators: true, emitDecoratorMetadata: true } }),
    'apps/api/src/app.module.ts': `import {Module} from '@nestjs/common'; import {GraphQLModule} from '@nestjs/graphql'; import {InputResolver} from './input.resolver'; @Module({imports:[GraphQLModule.forRoot({autoSchemaFile:true})],providers:[InputResolver]}) export class AppModule {}`,
    [`${SCHEMA_HOME}/limits.schema.ts`]: 'export const LIMIT = 60;',
    'apps/api/src/input.resolver.ts': resolver ?? `
import { Args, Field, Float, InputType, Query, Resolver } from '@nestjs/graphql';
import { ArrayMaxSize, Max, MaxLength, Min } from 'class-validator';
import { LIMIT } from '../../../src/modules/domain/inputs/limits.schema';
@InputType({isAbstract:true}) class BaseInput { @Field(()=>String, {name:'displayName'}) @MaxLength(LIMIT) label!:string; }
@InputType('CreateInput') class CreateCommandInput extends BaseInput {
  @Field(()=>[String]) @ArrayMaxSize(3) @MaxLength(12,{each:true}) tags!:string[];
  @Field(()=>Float,{nullable:true}) @Min(-2.5) @Max(8) count?:number;
  @Field(()=>[Float]) @ArrayMaxSize(2) @Min(0,{each:true}) @Max(1,{each:true}) coords!:[number,number];
}
@Resolver() export class InputResolver { @Query(()=>String) submit(@Args('input') input:CreateCommandInput):string { return input.label; } }
`,
  };
  const fixtureRoot = fixture(t, files);
  for (const name of ['typescript', '@nestjs/common', '@nestjs/core', '@nestjs/graphql', 'graphql', ...(validator ? ['class-validator'] : []), 'reflect-metadata']) {
    dependency(fixtureRoot.put, name);
  }
  return fixtureRoot;
}

const argumentsOf = (field: GraphQLInputField | undefined) => Object.fromEntries((field?.astNode?.directives?.[0]?.arguments ?? []).map((argument) => [argument.name.value, Number((argument.value as { value: string }).value)]));
const emittedInputFields = (root: string) => inputFields(buildSchema(fs.readFileSync(path.join(root, 'out/contracts/api/schema.graphql'), 'utf8')), 'CreateInput');
const emittedOpenApiInput = (root: string): Json => JSON.parse(fs.readFileSync(path.join(root, 'out/contracts/api/openapi.json'), 'utf8')).components.schemas['Operation.create.v1.Request'].properties.input;

test('starci app emit keeps inherited fields, nullable numbers and item bounds equal across GraphQL and OpenAPI and detects stale bounds', t => {
  const { root, put } = workerFixture(t);
  operationFiles(put, `
import {z} from 'zod';
import {LIMIT} from './limits.schema';
const BaseSchema = z.strictObject({displayName:z.string().max(LIMIT)});
const Coordinate = z.number().min(0).max(1);
export const InputSchema = BaseSchema.extend({tags:z.array(z.string().max(12)).max(3),count:z.number().min(-2.5).max(8).nullish(),coords:z.tuple([Coordinate,Coordinate])});
${OUTPUT}`);
  const declaration = { apps: [{ name: 'api', kind: 'api' }] };
  const emitted = emitContracts({ repoRoot: root, declaration, outDir: path.join(root, 'out') });
  assert.deepEqual(emitted.written, ['contracts/api/schema.graphql', 'contracts/api/openapi.json']);
  assert.deepEqual(emitted.standIns, {});
  const output = fs.readFileSync(path.join(root, 'out/contracts/api/schema.graphql'), 'utf8');
  const fields = inputFields(buildSchema(output), 'CreateInput');
  assert.deepEqual(argumentsOf(fields.displayName), { maxLength: 60 });
  assert.deepEqual(argumentsOf(fields.tags), { maxItems: 3, itemMaxLength: 12 });
  assert.deepEqual(argumentsOf(fields.count), { min: -2.5, max: 8 });
  assert.deepEqual(argumentsOf(fields.coords), {maxItems:2,itemMin:0,itemMax:1});
  const rest = emittedOpenApiInput(root).properties;
  assert.deepEqual(argumentsOf(fields.displayName), {maxLength:rest.displayName.maxLength});
  assert.deepEqual(argumentsOf(fields.tags), {maxItems:rest.tags.maxItems,itemMaxLength:rest.tags.items.maxLength});
  const numeric = rest.count.anyOf.find((part: Json) => part.type === 'number');
  assert.ok(rest.count.anyOf.some((part: Json) => part.type === 'null'));
  assert.deepEqual(argumentsOf(fields.count), {min:numeric.minimum,max:numeric.maximum});
  assert.equal(rest.coords.prefixItems.length, 2);
  for (const item of rest.coords.prefixItems) {
    assert.deepEqual(argumentsOf(fields.coords), {maxItems:rest.coords.maxItems,itemMin:item.minimum,itemMax:item.maximum});
  }
  const generated = inputBoundsPlugin(buildSchema(output) as unknown as Parameters<typeof inputBoundsPlugin>[0]);
  assert.match(generated, /"maxLength": 60/);
  assert.match(generated, /"itemMaxLength": 12/);
  assert.match(generated, /"min": -2.5/);
  put('contracts/api/schema.graphql', output);
  put('contracts/api/openapi.json', fs.readFileSync(path.join(root, 'out/contracts/api/openapi.json'), 'utf8'));
  const input = { repoRoot: root, files: ['contracts/api/schema.graphql', 'contracts/api/openapi.json'], repo: { profile: 'be', ...declaration }, emit: emitContracts };
  assert.deepEqual(contractEmitFindings(input).findings, []);
  put(`${SCHEMA_HOME}/limits.schema.ts`, 'export const LIMIT = 30;');
  assert.deepEqual(contractEmitFindings(input).findings.map(finding => finding.drift), ['stale', 'stale']);
});

test('GraphQL follows namespace validators and ignores similarly named local decorators', t => {
  const { root } = workerFixture(t, { resolver: `
import {Args, Field, InputType, Query, Resolver} from '@nestjs/graphql';
import * as validator from 'class-validator';
function MaxLength(value:number):PropertyDecorator { return () => {}; }
@InputType() class CreateInput { @Field(()=>String) @validator.MaxLength(20) name!:string; @Field(()=>String) @MaxLength(1) local!:string; }
@Resolver() export class InputResolver { @Query(()=>String) submit(@Args('input') input:CreateInput):string { return input.name; } }
` });
  const emitted = emitContracts({repoRoot:root, declaration:{apps:[{name:'api',kind:'api'}]}, outDir:path.join(root,'out')});
  assert.deepEqual(emitted.standIns, {});
  const fields = emittedInputFields(root);
  assert.deepEqual(argumentsOf(fields.name), {maxLength:20});
  assert.deepEqual(fields.local?.astNode?.directives, []);
});

test('GraphQL follows barrel validator aliases on a redeclared inherited property', t => {
  const { root, put } = workerFixture(t, { resolver: `
import {Args, Field, InputType, Query, Resolver} from '@nestjs/graphql';
import {Bound} from './validators';
@InputType({isAbstract:true}) class BaseInput { @Field(()=>String) @Bound(60) name!:string; }
@InputType() class CreateInput extends BaseInput { @Field(()=>String) declare name:string; }
@Resolver() export class InputResolver { @Query(()=>String) submit(@Args('input') input:CreateInput):string { return input.name; } }
` });
  put('apps/api/src/validators.ts', "export {MaxLength as Bound} from 'class-validator';");
  const emitted = emitContracts({repoRoot:root, declaration:{apps:[{name:'api',kind:'api'}]}, outDir:path.join(root,'out')});
  assert.deepEqual(emitted.standIns, {});
  assert.deepEqual(argumentsOf(emittedInputFields(root).name), {maxLength:60});
});

test('starci app emit versions input metadata even when numeric input fields declare no bounds', t => {
  const { root, put } = workerFixture(t);
  put('apps/api/src/input.resolver.ts', `
import { Args, Field, Float, InputType, Query, Resolver } from '@nestjs/graphql';
@InputType() class NumericInput { @Field(()=>Float) count!:number; }
@Resolver() export class InputResolver { @Query(()=>String) submit(@Args('input') input:NumericInput):string { return String(input.count); } }
`);
  const declaration = { apps: [{ name: 'api', kind: 'api' }] };
  emitContracts({ repoRoot: root, declaration, outDir: path.join(root, 'out') });
  const schema = buildSchema(fs.readFileSync(path.join(root, 'out/contracts/api/schema.graphql'), 'utf8'));
  assert.equal(schema.getDirective(INPUT_BOUNDS_DIRECTIVE)?.args.find((argument) => argument.name === INPUT_BOUNDS_VERSION_ARGUMENT)?.defaultValue, INPUT_BOUNDS_VERSION);
  assert.deepEqual(inputFields(schema, 'NumericInput').count?.astNode?.directives, []);
});

test('starci app emit still emits a GraphQL app whose repository has no class-validator, with the versioned directive and no field bounds', t => {
  const { root, put } = workerFixture(t, { validator: false });
  put('apps/api/src/input.resolver.ts', `
import { Args, Field, InputType, Query, Resolver } from '@nestjs/graphql';
@InputType() class PlainInput { @Field(()=>String) label!:string; }
@Resolver() export class InputResolver { @Query(()=>String) submit(@Args('input') input:PlainInput):string { return input.label; } }
`);
  emitContracts({ repoRoot: root, declaration: { apps: [{ name: 'api', kind: 'api' }] }, outDir: path.join(root, 'out') });
  const schema = buildSchema(fs.readFileSync(path.join(root, 'out/contracts/api/schema.graphql'), 'utf8'));
  assert.equal(schema.getDirective(INPUT_BOUNDS_DIRECTIVE)?.args.find((argument) => argument.name === INPUT_BOUNDS_VERSION_ARGUMENT)?.defaultValue, INPUT_BOUNDS_VERSION);
  assert.deepEqual(inputFields(schema, 'PlainInput').label?.astNode?.directives, []);
});

const CLASS_VALIDATOR_DTOS = `
import { Args, Field, InputType, Query, Resolver } from '@nestjs/graphql';
import { IsOptional, MaxLength } from 'class-validator';
@InputType({isAbstract:true}) class BaseInput { @Field(()=>String) @MaxLength(10) name!: string; @Field(()=>String) @MaxLength(10) nick!: string; }
@InputType('CreateInput') class CreateInput extends BaseInput { @Field(()=>String) @MaxLength(100) declare name: string; @Field(()=>String) @IsOptional() declare nick: string; }
@Resolver() export class InputResolver { @Query(()=>String) submit(@Args('input') input:CreateInput):string { return input.name; } }
`;

test('a subclass validator replaces inherited GraphQL bounds while IsOptional keeps them', t => {
  const { root } = workerFixture(t, {resolver:CLASS_VALIDATOR_DTOS});
  const emitted = emitContracts({repoRoot:root, declaration:{apps:[{name:'api',kind:'api'}]}, outDir:path.join(root,'out')});
  assert.deepEqual(emitted.standIns, {});
  const fields = emittedInputFields(root);
  assert.deepEqual(argumentsOf(fields.name), {maxLength:100});
  assert.deepEqual(argumentsOf(fields.nick), {maxLength:10});
});

test('GraphQL subclass validators and OpenAPI schema overrides state the same inherited limits', t => {
  const { root, put } = workerFixture(t, {resolver:CLASS_VALIDATOR_DTOS});
  operationFiles(put, `
import {z} from 'zod';
const BaseSchema = z.strictObject({name:z.string().max(10),nick:z.string().max(10)});
export const InputSchema = BaseSchema.extend({name:z.string().max(100),nick:BaseSchema.shape.nick.optional()});
${OUTPUT}`);
  const emitted = emitContracts({ repoRoot: root, declaration: { apps: [{ name: 'api', kind: 'api' }] }, outDir: path.join(root, 'out') });
  assert.deepEqual(emitted.written, ['contracts/api/schema.graphql','contracts/api/openapi.json']);
  assert.deepEqual(emitted.standIns, {});
  const fields = emittedInputFields(root);
  const input = emittedOpenApiInput(root);
  assert.equal(input.properties.name.maxLength, 100);
  assert.equal(input.properties.nick.maxLength, 10);
  assert.equal(input.required.includes('nick'), false);
  assert.deepEqual(argumentsOf(fields.name), {maxLength:input.properties.name.maxLength});
  assert.deepEqual(argumentsOf(fields.nick), {maxLength:input.properties.nick.maxLength});
});

test('the write pass (outDir is repoRoot) writes the snapshots in place, with no database types step left', t => {
  const { root } = workerFixture(t);
  const emitted = emitContracts({ repoRoot: root, declaration: { apps: [{ name: 'api', kind: 'api' }] } });
  assert.ok(emitted.written.includes('contracts/api/schema.graphql'), JSON.stringify(emitted));
  assert.ok(fs.existsSync(path.join(root, 'contracts/api/schema.graphql')));
  assert.equal('types' in emitted, false);
});
