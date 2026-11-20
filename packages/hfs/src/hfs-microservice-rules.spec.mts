// The microservice policy of `starci app check` (scripts/hfs/rules/services.mts): R163 HFS_SERVICE_PLACEMENT, R164 HFS_IMAGE_UNPINNED,
// R165 HFS_SERVICE_STACK_DECLARATION, R166 HFS_EVENT_CONTRACT (event classes -> events.json), plus the event contract emit
// (packages/hfs/emit). Each rule has a violating and a passing tree; the clean app of tests/helpers/hfs-cli-fixture.mjs is the base.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkRepo } from '../runtime/scripts/hfs/check.mjs';
import type { CheckFinding } from '../runtime/scripts/hfs/check.mjs';
import { byCodeUnit } from '../runtime/scripts/lib/list.mjs';
import { emitContracts } from '../emit/contracts.mjs';
import { APP, STACKS_DECLARATION, appOf, cleanup, gitAdd, installTypeScript, writeCleanRepo } from './helpers/hfs-cli-fixture.mjs';
import type { AppDeclaration } from './helpers/hfs-cli-fixture.mjs';

const MULTI = appOf({ be: { apps: [{ name: 'core', kind: 'api' }, { name: 'billing', kind: 'worker' }] } });
const made: string[] = [];
type Mutate = (dir: string) => void;
const repoOf = (declaration: AppDeclaration = MULTI, mutate?: Mutate) => {
  const dir = writeCleanRepo(declaration);
  made.push(dir);
  if (mutate) mutate(dir);
  return gitAdd(dir);
};
test.after(() => cleanup(made));

const put = (dir: string, relative: string, text = 'export {};\n') => {
  const target = path.join(dir, ...relative.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
};
const only = (declaration: AppDeclaration, mutate: Mutate | undefined, code: string) => checkRepo({ repoRoot: repoOf(declaration, mutate) }).findings.filter((f) => f.code === code);
const pathsOf = (findings: CheckFinding[]) => findings.map((f) => f.path!).sort(byCodeUnit);

const stack = (components: string) => `${STACKS_DECLARATION}components:\n${components}`;
const COMPONENTS = [
  '  postgres:', '    image: postgres:16.4@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '    role: stateful',
  '  core:', '    image: demo/core:1.0.0', '    role: service',
  '  billing:', '    image: demo/billing:1.0.0', '    role: service', '',
].join('\n');
const withStack = (components: string) => (dir: string) => put(dir, '.starcistacks/application-stacks.yaml', stack(components));

// ------------------------------------------------------------------------------------------------ R163 HFS_SERVICE_PLACEMENT

test('HFS_SERVICE_PLACEMENT: a Dockerfile or a package.json of a folder outside be/apps/<service> is a second service root', () => {
  const findings = only(APP, (dir) => {
    put(dir, 'services/billing/Dockerfile', 'FROM node\n');
    put(dir, 'be/billing/package.json', '{}\n');
    put(dir, 'Dockerfile', 'FROM node\n');
  }, 'HFS_SERVICE_PLACEMENT');
  assert.deepEqual(pathsOf(findings), ['Dockerfile', 'be/billing/package.json', 'services/billing/Dockerfile']);
  assert.match(findings[0]!.message!, /be\/apps\/<service>\//);
});

test('HFS_SERVICE_PLACEMENT: the Dockerfile of a be app, of a front-end app, the root package.json and the package.json of an fe workspace pass', () => {
  assert.deepEqual(only(APP, (dir) => {
    put(dir, 'be/apps/core/Dockerfile', 'FROM node\n');
    put(dir, 'fe/apps/web/Dockerfile', 'FROM node\n');
    put(dir, 'fe/packages/ui/package.json', '{}\n');
  }, 'HFS_SERVICE_PLACEMENT'), []);
});

test('HFS_SERVICE_PLACEMENT: a root workspace package (packages/<name>/package.json) is no service root; a Dockerfile or a nested manifest under packages/ still is', () => {
  const findings = only(APP, (dir) => {
    put(dir, 'packages/sdk/package.json', '{}\n');
    put(dir, 'packages/ui-kit/package.json', '{}\n');
    put(dir, 'packages/ui-kit/Dockerfile', 'FROM node\n');
    put(dir, 'packages/ui-kit/server/package.json', '{}\n');
  }, 'HFS_SERVICE_PLACEMENT');
  assert.deepEqual(pathsOf(findings), ['packages/ui-kit/Dockerfile', 'packages/ui-kit/server/package.json']);
});

test('HFS_SERVICE_PLACEMENT: an agent workbench (packages/<pkg>/workbench/<app>/package.json) with exact versions outside the workspaces is no service root; any other nested manifest still is', () => {
  const manifest = (dependencies: Record<string, string>) => `${JSON.stringify({ name: 'workbench', private: true, dependencies })}\n`;
  assert.deepEqual(only(APP, (dir) => {
    put(dir, 'packages/shop/workbench/orders/package.json', manifest({ react: '19.1.0' }));
  }, 'HFS_SERVICE_PLACEMENT'), []);
  const findings = only(APP, (dir) => {
    put(dir, 'packages/shop/workbench/orders/package.json', manifest({ react: '^19.1.0' }));
    put(dir, 'packages/shop/workbench/orders/web/package.json', manifest({}));
    put(dir, 'packages/shop/tools/orders/package.json', manifest({}));
  }, 'HFS_SERVICE_PLACEMENT');
  assert.deepEqual(pathsOf(findings), ['packages/shop/tools/orders/package.json', 'packages/shop/workbench/orders/package.json', 'packages/shop/workbench/orders/web/package.json']);
  assert.match(findings.find((f) => f.path === 'packages/shop/workbench/orders/package.json')!.message!, /dependencies\.react is "\^19\.1\.0", not an exact version/);
});

// ------------------------------------------------------------------------------------------------ R164 HFS_IMAGE_UNPINNED

test('HFS_IMAGE_UNPINNED: a multi-service stack with a moving image (no tag, latest, major only) is refused, each component named', () => {
  const findings = only(MULTI, withStack([
    '  postgres:', '    image: postgres:16', '    role: stateful',
    '  redis:', '    image: redis:latest', '    role: stateful',
    '  core:', '    image: demo/core', '    role: service',
    '  billing:', '    image: demo/billing:1.0.0', '    role: service', '',
  ].join('\n')), 'HFS_IMAGE_UNPINNED');
  assert.deepEqual(findings.map((f) => f.component).sort(byCodeUnit), ['core', 'postgres', 'redis']);
  assert.match(findings.find((f) => f.component === 'core')!.message!, /has no tag/);
  assert.match(findings.find((f) => f.component === 'postgres')!.message!, /not an exact version/);
});

test('HFS_IMAGE_UNPINNED: exact versions and digests pass, and a single-service product is not judged', () => {
  const digest = `quay.io/keycloak/keycloak@sha256:${'a'.repeat(64)}`;
  assert.deepEqual(only(MULTI, withStack(`${COMPONENTS}  keycloak:\n    image: ${digest}\n    role: stateful\n  minio:\n    image: cgr.dev/chainguard/minio:2024.1.2-r0\n    role: stateful\n`), 'HFS_IMAGE_UNPINNED'), []);
  assert.deepEqual(only(APP, withStack('  postgres:\n    image: postgres:16\n    role: stateful\n'), 'HFS_IMAGE_UNPINNED'), []);
});

// ------------------------------------------------------------------------------------------------ R165 HFS_SERVICE_STACK_DECLARATION

test('HFS_SERVICE_STACK_DECLARATION: a service app with no component, or one that is not role service, is refused', () => {
  const findings = only(MULTI, withStack('  core:\n    image: demo/core:1.0.0\n    role: stateful\n'), 'HFS_SERVICE_STACK_DECLARATION');
  assert.deepEqual(findings.map((f) => f.app).sort(byCodeUnit), ['billing', 'core']);
});

test('HFS_SERVICE_STACK_DECLARATION: every service app declared as a role service component passes', () => {
  assert.deepEqual(only(MULTI, withStack(COMPONENTS), 'HFS_SERVICE_STACK_DECLARATION'), []);
});

// ------------------------------------------------------------------------------------------------ R166 HFS_EVENT_CONTRACT

const EVENTS_DIR = 'be/src/modules/events';
const PLACED_PATH = `${EVENTS_DIR}/core/order-placed.event.ts`;
const REJECTED_PATH = `${EVENTS_DIR}/billing/invoice-rejected.event.ts`;
/** An event class in the shape of knowledge/patterns/be/event-bus.yaml: a payload interface, static eventName and version, create(payload). */
const eventClass = ({ className, name, version = 1, compensates, fields = 'readonly orderId: string; readonly totalCents: number; readonly note?: string' }: { className: string; name: string; version?: number; compensates?: string; fields?: string }) => `import { BaseEvent } from '@modules/platform/event-bus';
export interface ${className}Payload { ${fields} }
export class ${className} extends BaseEvent {
  static readonly eventName = "${name}";
  static readonly version = ${version};
${compensates === undefined ? '' : `  static readonly compensates = "${compensates}";\n`}  static create(payload: ${className}Payload): ${className} { return new ${className}(payload.orderId, payload); }
}
`;
const PLACED = eventClass({ className: 'OrderPlacedEvent', name: 'order.placed' });
const REJECTED = eventClass({ className: 'InvoiceRejectedEvent', name: 'billing.invoice-rejected', compensates: 'order.placed', fields: 'readonly orderId: string; readonly reason: string' });

/** What `starci app emit` writes for the event classes of `service`, in a scratch app that holds only those files. */
const emitted = (service: string, classes: Record<string, string>) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-events-'));
  made.push(temp);
  put(temp, 'package.json', '{}\n');
  installTypeScript(temp);
  for (const [file, text] of Object.entries(classes)) put(temp, file.replace(/^be\//, 'be/'), text);
  const out = path.join(temp, 'out');
  emitContracts({ repoRoot: path.join(temp, 'be'), declaration: { apps: [] }, outDir: out });
  return fs.readFileSync(path.join(out, 'contracts', service, 'events.json'), 'utf8');
};
/** The provider `core` (order.placed) and `billing` (invoice-rejected, compensating order.placed), their snapshots as emitted. */
const withEvents = ({ classes = { [PLACED_PATH]: PLACED, [REJECTED_PATH]: REJECTED }, snapshots = true }: { classes?: Record<string, string>; snapshots?: boolean } = {}) => (dir: string) => {
  withStack(COMPONENTS)(dir);
  for (const [file, text] of Object.entries(classes)) put(dir, file, text);
  if (snapshots) {
    for (const service of new Set(Object.keys(classes).map((file) => file.split("/")[4]!))) {
      const own = Object.fromEntries(Object.entries(classes).filter(([file]) => file.split('/')[4] === service));
      put(dir, `be/contracts/${service}/events.json`, emitted(service, own));
    }
  }
};
const r139 = (options?: Parameters<typeof withEvents>[0]) => only(MULTI, withEvents(options), 'HFS_EVENT_CONTRACT');

test('HFS_EVENT_CONTRACT: event classes whose vendored snapshots equal what they emit pass', () => {
  assert.deepEqual(r139(), []);
});

test('HFS_EVENT_CONTRACT: a service with event classes and no committed snapshot is refused', () => {
  assert.deepEqual(pathsOf(r139({ snapshots: false })), ['be/contracts/billing/events.json', 'be/contracts/core/events.json']);
});

test('HFS_EVENT_CONTRACT: a snapshot that no longer equals what the event classes emit is stale', () => {
  const findings = only(MULTI, (dir) => {
    withEvents()(dir);
    put(dir, PLACED_PATH, PLACED.replace('version = 1', 'version = 2'));
  }, 'HFS_EVENT_CONTRACT');
  assert.deepEqual(findings.map((f) => [f.path, f.drift]), [['be/contracts/core/events.json', 'stale']]);
});

test('HFS_EVENT_CONTRACT: a changed payload field is drift too, and an unreadable class is refused', () => {
  const drift = only(MULTI, (dir) => {
    withEvents()(dir);
    put(dir, PLACED_PATH, PLACED.replace('readonly totalCents: number', 'readonly totalCents: string'));
  }, 'HFS_EVENT_CONTRACT');
  assert.equal(drift.length, 1);
  const loose = only(MULTI, (dir) => {
    withEvents()(dir);
    put(dir, PLACED_PATH, PLACED.replace('static readonly version = 1', 'static readonly version = VERSION'));
  }, 'HFS_EVENT_CONTRACT');
  assert.match(loose.find((f) => f.path === PLACED_PATH)!.message!, /needs `static readonly version`/);
  const nested = only(MULTI, (dir) => {
    withEvents()(dir);
    put(dir, PLACED_PATH, PLACED.replace('readonly note?: string', 'readonly note: { text: string }'));
  }, 'HFS_EVENT_CONTRACT');
  assert.match(nested.find((f) => f.path === PLACED_PATH)!.message!, /payload field note must be/);
});

test('HFS_EVENT_CONTRACT: an event that compensates an event no class declares is refused, one that compensates a declared event passes', () => {
  const refused = only(MULTI, withEvents({ classes: { [PLACED_PATH]: PLACED, [REJECTED_PATH]: eventClass({ className: 'InvoiceRejectedEvent', name: 'billing.invoice-rejected', compensates: 'order.shipped', fields: 'readonly orderId: string' }) } }), 'HFS_EVENT_CONTRACT');
  assert.equal(refused.length, 1);
  assert.match(refused[0]!.message!, /compensates "order.shipped", which no event class declares/);
});

test('HFS_EVENT_CONTRACT: a committed snapshot of a service with no event class is left behind', () => {
  const findings = only(MULTI, (dir) => {
    withEvents()(dir);
    put(dir, 'be/contracts/shipping/events.json', '{}\n');
  }, 'HFS_EVENT_CONTRACT');
  assert.deepEqual(findings.map((f) => [f.path, f.drift]), [['be/contracts/shipping/events.json', 'left-behind']]);
});

test('starci app emit writes events.json for a service that declares event classes, sorted and with a final newline', () => {
  const text = emitted('billing', { [REJECTED_PATH]: REJECTED });
  assert.equal(text, `${JSON.stringify({ events: { 'billing.invoice-rejected': { compensates: 'order.placed', payload: { orderId: 'string', reason: 'string' }, version: 1 } }, schema: 'starci/event-contract@1', service: 'billing' }, null, 2)}\n`);
});
