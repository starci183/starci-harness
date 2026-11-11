/** The rest contract option: hfs.json `contract`, the emitted OpenAPI document and its drift (R23), its shape (R396), its additive evolution (R177) and the GraphQL doors a rest back end refuses (R278). */
// proves: BE_REST_OPERATION_ID@lite
// proves: BE_REST_OPERATION_ID@full
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { emitContracts } from '../emit/contracts.mjs';
import { contractEmitFindings } from '../runtime/scripts/hfs/rules/contract.mjs';
import { restBreakingChanges, restContractFindings, restContractProblems } from '../runtime/scripts/hfs/rules/rest-contract.mjs';
import { contractOf } from '../runtime/scripts/hfs/contract-kind.mjs';
import { HfsSlotsError, loadSlotManifest, resolveRepoDeclaration } from '../runtime/scripts/hfs/slots.mjs';

// reason: OpenAPI documents are JSON trees whose members the assertions judge.
type Json = any;
const require = createRequire(import.meta.url);

function fixture(t: TestContext, files: Record<string, string>) {
  const parent = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, 'starci-rest-contract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (relative: string, text: string) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  for (const [file, text] of Object.entries(files)) put(file, text);
  for (const name of ['typescript', '@nestjs/common', '@nestjs/core', '@nestjs/swagger', 'reflect-metadata']) put(`node_modules/${name}/package.json`, JSON.stringify({ name, main: require.resolve(name) }));
  return { root, put };
}

const HEAD = `import { DocumentBuilder } from '@nestjs/swagger';
export const OPENAPI = new DocumentBuilder().setTitle('crm').setVersion('1.0.0').addBearerAuth().build();`;
const DTOS = `import { ApiProperty } from '@nestjs/swagger';
export class ErrorDto { @ApiProperty() code!: string; @ApiProperty() message!: string; }
export class LeadDto { @ApiProperty() id!: string; @ApiProperty() name!: string; }
export class LeadPageDto { @ApiProperty({ type: [LeadDto] }) items!: LeadDto[]; @ApiProperty({ nullable: true, type: String }) nextCursor!: string | null; }
export class CreateLeadDto { @ApiProperty() name!: string; }`;
const CONTROLLER = `import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiDefaultResponse, ApiOkResponse, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { CreateLeadDto, ErrorDto, LeadDto, LeadPageDto } from './leads.dto';
@ApiBearerAuth() @ApiDefaultResponse({ type: ErrorDto }) @Controller('leads')
export class LeadsController {
  @ApiOperation({ operationId: 'leads.list' }) @ApiQuery({ name: 'cursor', required: false }) @ApiQuery({ name: 'limit', required: false }) @ApiOkResponse({ type: LeadPageDto })
  @Get() list(@Query('cursor') cursor?: string, @Query('limit') limit?: string): LeadPageDto { return { items: [], nextCursor: cursor ?? limit ?? null }; }
  @ApiOperation({ operationId: 'leads.create' }) @ApiOkResponse({ type: LeadDto })
  @Post() create(@Body() body: CreateLeadDto): LeadDto { return { id: '1', name: body.name }; }
}`;
const MODULE = `import { Module } from '@nestjs/common'; import { LeadsController } from './leads.controller'; @Module({ controllers: [LeadsController] }) export class AppModule {}`;
const REST = { apps: [{ name: 'api', kind: 'api', contract: 'rest' }] };

function restApp(t: TestContext) {
  return fixture(t, {
    'package.json': '{}',
    'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'commonjs', experimentalDecorators: true, emitDecoratorMetadata: true } }),
    'apps/api/src/app.module.ts': MODULE,
    'apps/api/src/openapi.ts': HEAD,
    'apps/api/src/leads.controller.ts': CONTROLLER,
    'apps/api/src/leads.dto.ts': DTOS,
  });
}

test('hfs.json contract: graphql is the default, rest is declared by an api app of be only, and one back end serves one kind', () => {
  const manifest = loadSlotManifest();
  const declare = (be: Json, fe: Json = { apps: [{ name: 'web', kind: 'next' }] }) => resolveRepoDeclaration(manifest, { hfs: 3, kind: 'app', project: 'shop', sides: { be, fe } });
  assert.equal(contractOf(declare({ apps: [{ name: 'api', kind: 'api' }] }).sides!.be.apps[0]), 'graphql');
  assert.deepEqual(declare({ apps: [{ name: 'api', kind: 'api' }] }).sides!.be.apps[0], { name: 'api', kind: 'api' }, 'a graphql app resolves exactly as before');
  assert.equal(contractOf(declare(REST).sides!.be.apps[0]), 'rest');
  const refused = (be: Json, fe?: Json) => assert.throws(() => declare(be, fe), (error: unknown) => error instanceof HfsSlotsError && error.code === 'HFS_DECLARATION_INVALID');
  refused({ apps: [{ name: 'api', kind: 'api', contract: 'soap' }] });
  refused({ apps: [{ name: 'cli', kind: 'cli', contract: 'rest' }] });
  refused({ apps: [{ name: 'api', kind: 'api' }] }, { apps: [{ name: 'web', kind: 'next', contract: 'rest' }] });
  refused({ apps: [{ name: 'api', kind: 'api', contract: 'rest' }, { name: 'admin', kind: 'api' }] });
});

test('starci app emit writes the OpenAPI document of a rest app from its controllers and head, and R23 judges it fresh, then stale', t => {
  const { root, put } = restApp(t);
  const emitted = emitContracts({ repoRoot: root, declaration: REST });
  assert.deepEqual(emitted.written, ['contracts/api/openapi.json']);
  const doc: Json = JSON.parse(fs.readFileSync(path.join(root, 'contracts/api/openapi.json'), 'utf8'));
  assert.equal(doc.info.version, '1.0.0');
  assert.equal(doc.paths['/leads'].get.operationId, 'leads.list');
  assert.deepEqual(restContractProblems(doc), [], 'the emitted document of the fixture app keeps every R396 law');
  const repo = { profile: 'be', apps: REST.apps } as Json;
  const files = ['contracts/api/openapi.json'];
  const fresh = contractEmitFindings({ repoRoot: root, files, repo, emit: emitContracts });
  assert.deepEqual(fresh.findings, []);
  assert.deepEqual(fresh.apps.map((entry: Json) => [entry.artifact, entry.status]), [['schema.graphql', 'none'], ['openapi.json', 'fresh']]);
  put('apps/api/src/leads.controller.ts', CONTROLLER.replace("'leads.create'", "'leads.add'"));
  const stale = contractEmitFindings({ repoRoot: root, files, repo, emit: emitContracts });
  assert.deepEqual(stale.findings.map((finding: Json) => [finding.code, finding.drift]), [['HFS_CONTRACT_SNAPSHOT_DRIFT', 'stale']]);
  console.log(`fail fixture R23: ${stale.findings[0]?.message}`);
});

const OK: Json = {
  openapi: '3.0.0', info: { title: 'crm', version: '1.0.0' }, security: [],
  components: {
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    schemas: {
      Error: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string' }, message: { type: 'string' } } },
      Lead: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, name: { type: 'string' } } },
      LeadPage: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Lead' } }, nextCursor: { type: 'string', nullable: true } } },
      CreateLead: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
    },
  },
  paths: {
    '/leads': {
      get: {
        operationId: 'leads.list', security: [{ bearer: [] }],
        parameters: [{ in: 'query', name: 'cursor', required: false, schema: { type: 'string' } }, { in: 'query', name: 'limit', required: false, schema: { type: 'number' } }],
        responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/LeadPage' } } } }, default: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } },
      },
      post: {
        operationId: 'leads.create', security: [{ bearer: [] }],
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateLead' } } } },
        responses: { 201: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Lead' } } } }, default: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } },
      },
    },
    '/health': { get: { operationId: 'health.live', security: [], 'x-public-reason': 'probe', responses: { 204: {}, default: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } } } },
  },
};
const clone = (): Json => structuredClone(OK);

test('R396: a stable, typed, secured, paged document passes; each law fails on its own fixture', () => {
  assert.deepEqual(restContractProblems(OK), []);
  const cases: Array<[string, (doc: Json) => void]> = [
    ['BE_REST_OPERATION_ID', (doc) => { doc.paths['/leads'].get.operationId = 'LeadsController_list'; }],
    ['BE_REST_OPERATION_ID', (doc) => { doc.paths['/leads'].post.operationId = 'leads.list'; }],
    ['BE_REST_UNTYPED', (doc) => { doc.paths['/leads'].post.requestBody.content['application/json'].schema = { type: 'object' }; }],
    ['BE_REST_UNTYPED', (doc) => { doc.paths['/leads'].post.responses[201] = { description: '' }; }],
    ['BE_REST_ERROR_SHAPE', (doc) => { doc.components.schemas.Error.required = ['code']; }],
    ['BE_REST_ERROR_SHAPE', (doc) => { doc.paths['/leads'].post.responses.default.content['application/json'].schema = { $ref: '#/components/schemas/Lead' }; }],
    ['BE_REST_ERROR_SHAPE', (doc) => { delete doc.paths['/leads'].post.responses.default; }],
    ['BE_REST_PAGINATION', (doc) => { doc.paths['/leads'].get.responses[200].content['application/json'].schema = { type: 'array', items: { $ref: '#/components/schemas/Lead' } }; }],
    ['BE_REST_PAGINATION', (doc) => { doc.paths['/leads'].get.parameters = []; }],
    ['BE_REST_SECURITY', (doc) => { delete doc.components.securitySchemes; }],
    ['BE_REST_SECURITY', (doc) => { delete doc.paths['/health'].get['x-public-reason']; }],
    ['BE_REST_SECURITY', (doc) => { delete doc.paths['/leads'].get.security; delete doc.security; }],
  ];
  for (const [code, mutate] of cases) {
    const doc = clone();
    mutate(doc);
    const problems = restContractProblems(doc);
    assert.deepEqual([...new Set(problems.map(([found]) => found))], [code], `${code}: ${JSON.stringify(problems)}`);
    console.log(`fail fixture ${code}: ${problems[0]![1]}`);
  }
});

test('R177: a REST contract changes additively against its pin, or raises the major of info.version', () => {
  assert.deepEqual(restBreakingChanges(OK, OK), []);
  const added = clone();
  added.paths['/leads/{id}'] = { get: { operationId: 'leads.read', responses: {} } };
  added.components.schemas.Lead.properties.email = { type: 'string' };
  assert.deepEqual(restBreakingChanges(OK, added), [], 'a new operation and a new answer field are additive');
  const broken = clone();
  delete broken.paths['/health'];
  broken.paths['/leads'].get.operationId = 'leads.all';
  broken.paths['/leads'].get.parameters.push({ in: 'query', name: 'owner', required: true, schema: { type: 'string' } });
  broken.components.schemas.CreateLead.required = ['name', 'phone'];
  delete broken.components.schemas.Lead.properties.name;
  const changes = restBreakingChanges(OK, broken);
  assert.deepEqual(changes, [
    'GET /leads is renamed from leads.list to leads.all',
    'GET /leads adds the required parameter query:owner',
    'POST /leads requires the new body field phone',
    'POST /leads 201 drops the field name',
    'GET /health (health.live) is removed',
  ]);
  for (const change of changes) console.log(`fail fixture BE_CONTRACT_BREAKING: ${change}`);
  broken.info.version = '2.0.0';
  assert.deepEqual(restBreakingChanges(OK, broken), [], 'a major raise publishes the break');
});

test('restContractFindings reads the committed snapshot and pin of each rest app and refuses GraphQL doors in a rest back end (R278)', t => {
  const { root, put } = fixture(t, {});
  put('contracts/api/openapi.json', JSON.stringify(OK));
  const pinned = clone();
  pinned.paths['/gone'] = { get: { operationId: 'gone.read', responses: {} } };
  put('contracts/api/openapi.pin.json', JSON.stringify(pinned));
  const files = ['contracts/api/openapi.json', 'contracts/api/openapi.pin.json', 'src/features/api/leads/transport/graphql/leads.resolver.ts', 'src/modules/platform/graphql/graphql.module.ts'];
  const rest = restContractFindings({ repoRoot: root, repo: { profile: 'be', apps: REST.apps } as Json, files });
  assert.deepEqual(rest.map((finding: Json) => [finding.code, finding.path]), [
    ['BE_REST_APP_GRAPHQL', 'src/features/api/leads/transport/graphql/leads.resolver.ts'],
    ['BE_REST_APP_GRAPHQL', 'src/modules/platform/graphql/graphql.module.ts'],
    ['BE_CONTRACT_BREAKING', 'contracts/api/openapi.json'],
  ]);
  for (const finding of rest) console.log(`fail fixture ${finding.code}: ${finding.message}`);
  assert.deepEqual(restContractFindings({ repoRoot: root, repo: { profile: 'be', apps: [{ name: 'api', kind: 'api' }] } as Json, files }), [], 'a graphql back end is not judged');
});
