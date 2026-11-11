// add-api-rest.spec.mts - `starci app add api <feature>` writes the door of the contract the app's api apps declare (BE-TRANSPORT-1,
// BE-TRANSPORT-4): a rest app gets the swagger-described controller, its DTOs, mapper and HTTP module, composed in the api group, and never
// a GraphQL door, peer or platform (R278); a graphql app keeps its resolver. The emitted document and R396 are proved on a scaffold (rest-contract.spec).
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init } from '../runtime/scripts/api/git/init.mjs';
import { bundledPresets } from '../sync/index.mjs';
import { scaffoldApp } from '../scaffold/app.mjs';
import { addKind } from '../scaffold/add.mjs';
import { entriesForContract, readTree } from '../scaffold/add-plan.mjs';

const app = (t: TestContext, contract: 'graphql' | 'rest'): string => {
  const into = fs.mkdtempSync(path.join(os.tmpdir(), `hfs-add-api-${contract}-`));
  t.after(() => fs.rmSync(into, { recursive: true, force: true }));
  return scaffoldApp({
    name: 'demo', into, harness: { version: '1.1.0-alpha.3' }, edition: 'lite', presets: bundledPresets(), sides: ['be'], contract,
    lock: (dir: string) => { fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}\n'); return { ok: true as const }; }, initGit: init,
  }).root;
};
const read = (root: string, relative: string): string => fs.readFileSync(path.join(root, ...relative.split('/')), 'utf8');
/** The domain service the handler delegates to (a lite add api registers it on the domain barrel), then the api feature. */
const addOrders = (root: string) => {
  const domain = path.join(root, 'be', 'src', 'modules', 'domain', 'orders');
  fs.mkdirSync(domain, { recursive: true });
  fs.writeFileSync(path.join(domain, 'orders.module.ts'), 'export class OrdersModule {}\n');
  fs.writeFileSync(path.join(domain, 'index.ts'), 'export { OrdersModule } from "./orders.module"\n');
  fs.writeFileSync(path.join(domain, 'orders.service.ts'), 'export class OrdersService {}\n');
  return addKind({ repoRoot: root, noun: 'api', name: 'orders', options: { service: 'OrdersService=@modules/domain/orders' } });
};
const FEATURE = 'be/src/features/api/orders';

test('a rest app gets the REST door: controller, DTOs, mapper and HTTP module, composed in the api group', (t) => {
  const root = app(t, 'rest');
  const packageBefore = read(root, 'package.json');
  const { created, notes } = addOrders(root);
  for (const file of ['orders.controller.ts', 'orders.mapper.ts', 'dto/orders.request.ts', 'dto/orders.response.ts', 'orders-http.module.ts', 'orders-http.module-definition.ts', 'orders-http.options.ts']) {
    assert.ok(created.includes(`${FEATURE}/transport/http/${file}`), file);
  }
  assert.ok(!created.some((file) => file.includes('/graphql/')), 'no GraphQL door, R278');
  assert.equal(fs.existsSync(path.join(root, 'be', 'src', 'modules', 'platform', 'graphql')), false, 'no GraphQL platform');
  assert.equal(read(root, 'package.json'), packageBefore, 'no GraphQL peers');
  assert.equal(read(root, `${FEATURE}/index.ts`), 'export { OrdersHttpModule } from "./transport/http/orders-http.module"\n');
  const controller = read(root, `${FEATURE}/transport/http/orders.controller.ts`);
  assert.match(controller, /@ApiOperation\(\{ operationId: "orders\.orders" \}\)/);
  assert.match(controller, /@ApiDefaultResponse\(\{ type: ErrorResponse \}\)/);
  assert.match(controller, /@ApiBearerAuth\(\)/);
  assert.match(controller, /@CurrentPrincipal\(\) principal: Principal/);
  assert.match(read(root, `${FEATURE}/transport/http/dto/orders.request.ts`), /@ApiProperty\(\{ maxLength: 64 \}\)\n {4}@IsString\(\)/);
  assert.match(read(root, `${FEATURE}/transport/http/dto/orders.response.ts`), /export class OrdersResponse \{\n {4}\/\*\* The id of the subject\. \*\/\n {4}@ApiProperty\(\)/);
  assert.match(read(root, 'be/apps/api/src/compose/api.ts'), /OrdersHttpModule\.register\(\{\}\)/);
  assert.doesNotMatch(read(root, 'be/apps/api/src/compose/api.ts'), /Graphql/);
  const declared = JSON.parse(read(root, 'hfs.json')).sides.be.optionalSlots;
  assert.ok(declared.includes('be.contract.openapi') && !declared.includes('be.contract.graphql'));
  assert.ok(notes?.some((note) => note.startsWith('npm run contract:emit')), 'the owner step names the emit');
});

test('a graphql app keeps its resolver door and writes no REST door', (t) => {
  const root = app(t, 'graphql');
  const { created } = addOrders(root);
  assert.ok(created.includes(`${FEATURE}/transport/graphql/orders.resolver.ts`));
  assert.ok(!created.some((file) => file.includes('/transport/http/')));
  assert.equal(read(root, `${FEATURE}/index.ts`), 'export { OrdersGraphqlModule } from "./transport/graphql/orders-graphql.module"\n');
});

test('a contract entry belongs to its contract alone, its optional notwithstanding, with its contract body', () => {
  const tree = readTree('api');
  const rest = entriesForContract(tree, 'rest');
  const graphql = entriesForContract(tree, 'graphql');
  const controller = 'src/features/api/<feature>/transport/http/<action>.controller.ts';
  assert.equal(rest.find((entry) => entry.path === controller)?.optional, false);
  assert.equal(graphql.find((entry) => entry.path === controller), undefined);
  assert.equal(rest.find((entry) => entry.path === 'src/features/api/<feature>/index.ts')?.template, 'api/feature.index.rest.ts.tpl');
  assert.equal(graphql.find((entry) => entry.path === 'src/features/api/<feature>/index.ts')?.template, 'api/feature.index.ts.tpl');
  assert.ok(!rest.some((entry) => entry.path.includes('/graphql/')));
});
