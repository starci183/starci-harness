// R389 (rules/stacks-local.mts, scripts/hfs/stack-base-port.mts): the project base port of a dev environment, the role table its native process
// ports follow, the warning of an app that declares none, and the overlap row of `starci app stack doctor` against the other apps of the machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withMachine } from '../runtime/engine/db/machine.mjs';
import { stacksLocalFindings } from '../runtime/scripts/hfs/rules/stacks-local.mjs';
import { basePortProblems, BASE_PORT_SPAN, overlapsReserved, rangesOverlap, roleOf } from '../runtime/scripts/hfs/stack-base-port.mjs';
import { normalizeLocal } from '../runtime/scripts/hfs/stack-local-config.mjs';
import type { LocalConfig } from '../stack/local-config.mjs';
import { basePortRows, machinePeers } from '../stack/local-peers.mjs';
import type { PeerBase } from '../stack/local-peers.mjs';
import { scaffoldBasePort } from '../scaffold/app.mjs';

/** A local block whose native processes are `processes` (name -> port) and whose compose-only ports are `containers`. */
function block(processes: Record<string, number>, { basePort, containers = { db: 54322 } }: { basePort?: number; containers?: Record<string, number> } = {}) {
  const raw = {
    ...(basePort === undefined ? {} : { basePort }),
    ports: { ...containers, ...processes },
    services: [{ name: 'db', wait: 'healthy' }],
    processes: Object.keys(processes).map((name) => ({ name, argv: ['node', `${name}.js`], port: name })),
  };
  return normalizeLocal(raw, { project: 'demo', env: 'dev' });
}
const problems = (processes: Record<string, number>, basePort: number): string[] => {
  const { config, problems: parse } = block(processes, { basePort });
  assert.deepEqual(parse, []);
  return basePortProblems(config!).map((item) => `${item.at} ${item.message}`);
};

test('the base port parses: absent is null, a whole port with room for base+99 is kept, anything else is refused', () => {
  assert.equal(block({ web: 3000 }).config?.basePort, null);
  assert.equal(block({ web: 3000 }, { basePort: 3000 }).config?.basePort, 3000);
  assert.equal(block({ web: 65436 }, { basePort: 65436 }).config?.basePort, 65436);
  for (const bad of [3000.5, '3000', 80, 1023, 65437, 70000, -1, null]) {
    const parsed = normalizeLocal({ basePort: bad, ports: { db: 54322 }, services: [{ name: 'db', wait: 'healthy' }] }, { project: 'demo', env: 'dev' });
    assert.match(parsed.problems.map((item) => `${item.at}: ${item.message}`).join('|'), /basePort: must be a whole port from 1024 to 65436/u, String(bad));
  }
});

test('the role table accepts the nivo layout: web base, api base+1, gateway base+2, mcp and landing above', () => {
  assert.deepEqual(problems({ web: 3100, api: 3101, gateway: 3102, mcp: 3103, landing: 3104 }, 3100), []);
});

test('the role table accepts the starci-next layout: no gateway, so landing may sit at base+2', () => {
  assert.deepEqual(problems({ app: 3000, core: 3001, landing: 3002 }, 3000), []);
});

test('the gateway slot is base+2 only when a gateway exists: with one, a further process at base+2 is a violation; without, it is legal', () => {
  assert.deepEqual(problems({ web: 3100, api: 3101, mcp: 3102 }, 3100), []);
  const clash = block({ web: 3100, api: 3101, gateway: 3103, mcp: 3102 }, { basePort: 3100 });
  assert.deepEqual(clash.problems, []);
  const text = basePortProblems(clash.config!).map((item) => `${item.at} ${item.message}`);
  assert.equal(text.length, 2, text.join('\n'));
  assert.match(text[0] ?? '', /processes\.gateway is the AI gateway: basePort \+ 2 = 3102, not 3103/u);
  assert.match(text[1] ?? '', /processes\.mcp is a further native process: its port must be from 3103 to 3199/u);
});

test('base and base+1 stay reserved for the front end and the api even when neither runs; the span is base..base+99', () => {
  assert.match(problems({ mcp: 3101 }, 3100).join('|'), /processes\.mcp is a further native process: its port must be from 3102 to 3199/u);
  assert.deepEqual(problems({ mcp: 3102 }, 3100), []);
  assert.deepEqual(problems({ web: 3100, worker: 3199 }, 3100), []);
  assert.match(problems({ web: 3100, worker: 3200 }, 3100).join('|'), /processes\.worker .* not 3200/u);
  assert.equal(BASE_PORT_SPAN, 100);
});

test('a front end, api or gateway off its slot is a violation that names the port it must have', () => {
  const text = problems({ web: 3101, api: 3100, gateway: 3105 }, 3100).join('\n');
  assert.match(text, /processes\.web is the primary front end: basePort = 3100, not 3101/u);
  assert.match(text, /processes\.api is the api: basePort \+ 1 = 3101, not 3100/u);
  assert.match(text, /processes\.gateway is the AI gateway: basePort \+ 2 = 3102, not 3105/u);
});

test('only the first process of a role takes its slot: a second front end is a further process', () => {
  assert.deepEqual(problems({ web: 3100, console: 3104 }, 3100), []);
  assert.match(problems({ web: 3100, console: 3100 + 100 }, 3100).join('|'), /processes\.console is a further native process/u);
  assert.match(problems({ web: 3100, console: 3101 }, 3100).join('|'), /processes\.console is a further native process: its port must be from 3102/u);
});

test('compose service ports and processes without a port are exempt, and an app with no base is not judged', () => {
  assert.deepEqual(problems({ web: 3100, api: 3101 }, 3100), []);
  const withContainers = block({ web: 3100 }, { basePort: 3100, containers: { db: 54322, redis: 56379, minio: 59000 } });
  assert.deepEqual(basePortProblems(withContainers.config!), []);
  assert.deepEqual(basePortProblems(block({ web: 9999 }).config!), []);
  const portless = normalizeLocal({ basePort: 3100, ports: { web: 3100 }, services: [{ name: 'db', wait: 'started' }], processes: [{ name: 'web', argv: ['node', 'w.js'] }, { name: 'worker', argv: ['node', 'x.js'] }] }, { project: 'demo', env: 'dev' });
  assert.deepEqual(basePortProblems(portless.config!), []);
});

test('the role of a process is its name', () => {
  for (const [name, role] of [['web', 'frontend'], ['app', 'frontend'], ['console', 'frontend'], ['api', 'api'], ['core', 'api'], ['gateway', 'gateway'], ['ai-router', 'gateway'], ['mcp', 'other'], ['landing', 'other']] as const) assert.equal(roleOf(name), role, name);
  assert.equal(rangesOverlap(3000, 3099), true);
  assert.equal(rangesOverlap(3000, 3100), false);
  assert.equal(rangesOverlap(3100, 3000), false);
});

const COMPOSE_ENV = (local: string): string => `  dev:\n    status: supported\n    runtime: docker-compose\n    composeFiles: [infra/compose/compose.yaml]\n    components: {}\n    runbook: README.md\n    secrets: []\n    local:\n${local}`;

function app(t: { after: (fn: () => void) => void }, local: string, project = 'demo'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-base-port-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'hfs.json'), JSON.stringify({ hfs: 3, kind: 'app', edition: 'lite', project }));
  const dev = path.join(root, '.starcistacks', 'dev');
  fs.mkdirSync(path.join(dev, 'infra', 'compose'), { recursive: true });
  fs.writeFileSync(path.join(dev, 'infra', 'compose', 'compose.yaml'), 'services:\n  db:\n    image: postgres\n');
  fs.writeFileSync(path.join(dev, 'README.md'), '# dev\n\nRun `starci app stack up --env dev --execute`.\n');
  fs.writeFileSync(path.join(root, '.starcistacks', 'application-stacks.yaml'), `schema: starci/application-stacks@1\nenvironments:\n${COMPOSE_ENV(local)}`);
  return root;
}
const findings = (root: string) => stacksLocalFindings({ repoRoot: root, repo: { kind: 'app', edition: 'lite' } as never, isRoot: true });
const processesBlock = (ports: string, processes: string[], base = ''): string => `${base}      ports: {db: 54322, ${ports}}\n      services: [{name: db, wait: healthy}]\n      processes:\n${processes.map((name) => `        - {name: ${name}, argv: [node, ${name}.js], port: ${name}}\n`).join('')}`;

test('R389 a layout that follows the role table raises nothing; one off it is STACKS_BASE_PORT_ROLE, an error naming the port', (t) => {
  assert.deepEqual(findings(app(t, processesBlock('web: 3100, api: 3101, gateway: 3102, mcp: 3103, landing: 3104', ['web', 'api', 'gateway', 'mcp', 'landing'], '      basePort: 3100\n'))), []);
  const off = findings(app(t, processesBlock('web: 3100, api: 3102', ['web', 'api'], '      basePort: 3100\n')));
  assert.deepEqual(off.map((finding) => [finding.code, finding.level]), [['STACKS_BASE_PORT_ROLE', 'error']]);
  assert.match(off[0]?.message ?? '', /environments\.dev\.local\.processes\.api: is the api: basePort \+ 1 = 3101, not 3102 \(basePort 3100/u);
});

test('R389 an app with native processes on ports and no basePort gets STACKS_BASE_PORT_UNDECLARED as a warning, never an error', (t) => {
  const missing = findings(app(t, processesBlock('web: 3000, api: 3001', ['web', 'api'])));
  assert.deepEqual(missing.map((finding) => [finding.code, finding.level]), [['STACKS_BASE_PORT_UNDECLARED', 'warning']]);
  assert.match(missing[0]?.message ?? '', /environments\.dev\.local\.basePort is not declared/u);
  const containersOnly = findings(app(t, '      ports: {db: 54322}\n      services: [{name: db, wait: healthy}]\n'));
  assert.deepEqual(containersOnly, [], 'nothing native to place: nothing to ask for');
});

test('R389 a malformed basePort is the local-block finding STACKS_LOCAL_CONFIG_INVALID, not a second one', (t) => {
  const bad = findings(app(t, processesBlock('web: 3000', ['web'], '      basePort: 80\n')));
  assert.deepEqual(bad.map((finding) => finding.code), ['STACKS_LOCAL_CONFIG_INVALID']);
});

const BASE_APP = (base: number | null): string => `${base === null ? '' : `      basePort: ${base}\n`}      ports: {db: 54322, web: ${base ?? 3000}}\n      services: [{name: db, wait: healthy}]\n      processes:\n        - {name: web, argv: [node, web.js], port: web}\n`;

function localOf(root: string, basePort: number | null, ports: Record<string, number> = { web: basePort ?? 3000 }): LocalConfig {
  const { config } = normalizeLocal({ ...(basePort === null ? {} : { basePort }), ports: { db: 54322, ...ports }, services: [{ name: 'db', wait: 'healthy' }], processes: Object.keys(ports).map((name) => ({ name, argv: ['node', 'x.js'], port: name })) }, { project: 'demo', env: 'dev' });
  return { ...config!, env: 'dev', appProject: 'demo', repoRoot: root, envDir: root, composeFiles: [], secretsDir: root };
}

test('doctor rows: the role table and the range are ok rows, a table violation and an overlapping app are fail rows', () => {
  const peers: PeerBase[] = [{ project: 'nivo', repoRoot: 'D:/apps/nivo', basePort: 3100 }, { project: 'other', repoRoot: 'D:/apps/other', basePort: 4000 }];
  const clear = basePortRows(localOf('x', 3300), peers);
  assert.deepEqual(clear.map((row) => [row.id, row.ok]), [['base port', true], ['port range', true]]);
  assert.match(clear[1]?.detail ?? '', /3300\.\.3399 overlaps no other app of this machine \(2 with a base port checked\)/u);
  const clash = basePortRows(localOf('x', 3050), peers);
  assert.deepEqual(clash.map((row) => [row.id, row.ok]), [['base port', true], ['port range', false]]);
  assert.match(clash[1]?.detail ?? '', /3050\.\.3149 overlaps nivo \(3100\.\.3199, D:\/apps\/nivo\)/u);
  assert.doesNotMatch(clash[1]?.detail ?? '', /other/u);
  assert.equal(basePortRows(localOf('x', 3100), peers)[1]?.ok, false, 'equal bases overlap');
  assert.equal(basePortRows(localOf('x', 3200), peers)[1]?.ok, true, 'bases a span apart do not');
  const off = basePortRows(localOf('x', 3300, { web: 3301 }), peers);
  assert.equal(off[0]?.ok, false);
  assert.match(off[0]?.detail ?? '', /processes\.web is the primary front end: basePort = 3300, not 3301/u);
  const none = basePortRows(localOf('x', null), peers);
  assert.deepEqual(none.map((row) => [row.id, row.ok]), [['base port', true]], 'no base declared: one ok row asking for it, no overlap to judge');
});

test('machinePeers reads the other apps from the machine registry: the same env, one per project, never this app or a lane of it', (t) => {
  const registry = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-base-port-registry-'));
  t.after(() => fs.rmSync(registry, { recursive: true, force: true }));
  const file = path.join(registry, 'machine.sqlite');
  const env = { STARCI_TEST_MACHINE_FILE: file } as NodeJS.ProcessEnv;
  const own = app(t, BASE_APP(3000));
  const lane = app(t, BASE_APP(3000));
  const nivo = app(t, BASE_APP(3100), 'nivo');
  const bare = app(t, BASE_APP(null), 'legacy');
  const retired = app(t, BASE_APP(3500), 'gone');
  const registered = [own, lane, nivo, bare, retired];
  withMachine((m) => {
    registered.forEach((root, index) => m.registerLedger({ ledgerId: `ledger-${index}`, name: path.basename(root), repoRoot: root, file: path.join(registry, `ledger-${index}.sqlite`) }));
    m.setLedgerState('ledger-4', 'retired', { reason: 'spec' });
  }, { file, env });
  const peers = machinePeers({ env }, { repoRoot: own, appProject: 'demo', env: 'dev' });
  assert.deepEqual(peers.map((peer) => [peer.project, peer.basePort]), [['nivo', 3100]]);
  assert.deepEqual(machinePeers({ env }, { repoRoot: own, appProject: 'demo', env: 'staging' }), [], 'another environment name declares nothing');
  assert.deepEqual(machinePeers({ env: { STARCI_TEST_MACHINE_FILE: path.join(registry, 'absent.sqlite') } as NodeJS.ProcessEnv }, { repoRoot: own, appProject: 'demo', env: 'dev' }), [], 'no registry: no peers, no failure');
});

test('the preview range 3900..3999 is reserved: a base whose range overlaps it fails a doctor row', () => {
  assert.equal(overlapsReserved(3900), true);
  assert.equal(overlapsReserved(3850), true);
  assert.equal(overlapsReserved(3999), true);
  assert.equal(overlapsReserved(3800), false);
  assert.equal(overlapsReserved(4000), false);
  const rows = basePortRows(localOf('x', 3850, { web: 3850 }), []);
  assert.deepEqual(rows.map((row) => [row.id, row.ok]), [['base port', true], ['port range reserved', false], ['port range', true]]);
  assert.match(rows[1]?.detail ?? '', /3850\.\.3949 overlaps 3900\.\.3999, reserved for the shared UI-lane next dev preview/u);
});

test('the scaffold starts a new app on a base of its own in 3000..4900, in steps of the span', () => {
  const bases = new Set(['alpha', 'beta', 'gamma', 'delta', 'nivo', 'starci-next', 'shop'].map(scaffoldBasePort));
  for (const base of bases) assert.ok(base >= 3000 && base <= 4900 && base % 100 === 0 && !overlapsReserved(base), String(base));
  for (let i = 0; i < 200; i += 1) assert.ok(!overlapsReserved(scaffoldBasePort(`app-${i}`)), `app-${i}`);
  assert.ok(bases.size > 1, 'the base follows the project name');
  assert.equal(scaffoldBasePort('alpha'), scaffoldBasePort('alpha'));
});
