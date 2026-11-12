// R389 (rules/stacks-local.mts, scripts/hfs/stack-base-port.mts): the project base port of a dev environment, the role table its native process
// ports follow, the warning of an app that declares none, and the overlap against the other apps of the machine: the row of `starci app stack doctor`,
// the report-only finding of `starci app check --env local` and the refusal of `starci app stack up`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withMachine } from '../runtime/engine/db/machine.mjs';
import { stacksLocalFindings } from '../runtime/scripts/hfs/rules/stacks-local.mjs';
import { basePortProblems, BASE_PORT_SPAN, COMPOSE_BAND, COMPOSE_ROLES, composePort, composePorts, literalPublishes, overlapsReserved, rangesOverlap, roleOf } from '../runtime/scripts/hfs/stack-base-port.mjs';
import { normalizeLocal } from '../runtime/scripts/hfs/stack-local-config.mjs';
import type { LocalConfig } from '../stack/local-config.mjs';
import { spawnSync } from 'node:child_process';
import { basePortRows, harnessHomeOf, machinePeers, machineRegistries, nextFreeBase, overlapsOf } from '../stack/local-peers.mjs';
import type { MachinePeers, PeerBase } from '../stack/local-peers.mjs';
import { scaffoldBase, scaffoldBasePort } from '../scaffold/app.mjs';
import { ScaffoldError } from '../scaffold/service.mjs';
import { liveStateFindings } from '../stack/local-live-checks.mjs';
import { loadLocalConfig } from '../stack/local-config.mjs';
import { upLocal } from '../stack/local-up.mjs';
import { stackContext } from '../stack/context.mjs';
import type { StackContext } from '../stack/context.mjs';
import { parse as parseYaml } from 'yaml';

/** The failure-code catalog, read from the runtime. */
const failureCatalog = (): Record<string, { kind?: string } | undefined> => parseYaml(fs.readFileSync(new URL('../runtime/modules/kernel/failure-codes.yaml', import.meta.url), 'utf8')) as Record<string, { kind?: string } | undefined>;

/** A local block whose native processes are `processes` (name -> port) and whose compose-only ports are `containers`. */
function block(processes: Record<string, number>, { basePort, containers = { cache: 56379 } }: { basePort?: number; containers?: Record<string, number> } = {}) {
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

test('the role table accepts the first layout: web base, api base+1, gateway base+2, mcp and landing above', () => {
  assert.deepEqual(problems({ web: 3100, api: 3101, gateway: 3102, mcp: 3103, landing: 3104 }, 3100), []);
});

test('the role table accepts the second layout: no gateway, so landing may sit at base+2', () => {
  assert.deepEqual(problems({ app: 3000, core: 3001, landing: 3002 }, 3000), []);
});

test('the gateway slot is base+2 only when a gateway exists: with one, a further process at base+2 is a violation; without, it is legal', () => {
  assert.deepEqual(problems({ web: 3100, api: 3101, mcp: 3102 }, 3100), []);
  const clash = block({ web: 3100, api: 3101, gateway: 3103, mcp: 3102 }, { basePort: 3100 });
  assert.deepEqual(clash.problems, []);
  const text = basePortProblems(clash.config!).map((item) => `${item.at} ${item.message}`);
  assert.equal(text.length, 2, text.join('\n'));
  assert.match(text[0] ?? '', /processes\.gateway is the AI gateway: basePort \+ 2 = 3102, not 3103/u);
  assert.match(text[1] ?? '', /processes\.mcp is a further native process: its port must be from 3103 to 3179/u);
});

test('base and base+1 stay reserved for the front end and the api even when neither runs; native processes stay below the compose band', () => {
  assert.match(problems({ mcp: 3101 }, 3100).join('|'), /processes\.mcp is a further native process: its port must be from 3102 to 3179/u);
  assert.deepEqual(problems({ mcp: 3102 }, 3100), []);
  assert.deepEqual(problems({ web: 3100, worker: 3179 }, 3100), []);
  assert.match(problems({ web: 3100, worker: 3180 }, 3100).join('|'), /processes\.worker is a further native process: its port must be from 3102 to 3179 \(basePort \+ 2 to basePort \+ 79\), not 3180/u);
  assert.match(problems({ web: 3100, worker: 3200 }, 3100).join('|'), /processes\.worker .* not 3200/u);
  assert.equal(BASE_PORT_SPAN, 100);
  assert.equal(COMPOSE_BAND, 80);
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

test('compose ports with a role sit on their slot: db base+90, mail base+91, mailui base+92, storage base+93, storage-console base+94', () => {
  const onSlots = block({ web: 3100, api: 3101 }, { basePort: 3100, containers: { db: 3190, mail: 3191, mailui: 3192, storage: 3193, 'storage-console': 3194 } });
  assert.deepEqual(onSlots.problems, []);
  assert.deepEqual(basePortProblems(onSlots.config!), []);
  assert.deepEqual(composePorts(onSlots.config!).map((entry) => [entry.name, entry.role]), [['db', 'db'], ['mail', 'mail'], ['mailui', 'mailui'], ['storage', 'storage'], ['storage-console', 'storage-console']]);
  const fixed = block({ web: 3100 }, { basePort: 3100, containers: { db: 54322, mail: 1025, mailui: 8025, storage: 59000, 'storage-console': 59001 } });
  const text = basePortProblems(fixed.config!);
  assert.deepEqual(text.map((problem) => problem.code), Array(5).fill('STACKS_COMPOSE_PORT_ROLE'));
  assert.deepEqual(text.map((problem) => `${problem.at} ${problem.message}`), [
    'ports.db is the db compose port: basePort + 90 = 3190, not 54322',
    'ports.mail is the mail compose port: basePort + 91 = 3191, not 1025',
    'ports.mailui is the mailui compose port: basePort + 92 = 3192, not 8025',
    'ports.storage is the storage compose port: basePort + 93 = 3193, not 59000',
    'ports.storage-console is the storage-console compose port: basePort + 94 = 3194, not 59001',
  ]);
  assert.deepEqual(Object.fromEntries(Object.keys(COMPOSE_ROLES).map((role) => [role, composePort(3000, role as keyof typeof COMPOSE_ROLES)])), { db: 3090, mail: 3091, mailui: 3092, storage: 3093, 'storage-console': 3094 });
});

test('the database role is the port local.database names, whatever its name; a port a native process holds plays no compose role', () => {
  const named = normalizeLocal({ basePort: 3100, ports: { pg: 54332, web: 3100 }, services: [{ name: 'db', wait: 'healthy' }], database: { service: 'db', port: 'pg', urlEnv: 'PRIMARY_DB_URL', password: { member: 'db', key: 'OWNER' }, adminPassword: { member: 'db', key: 'ADMIN' } }, processes: [{ name: 'web', argv: ['node', 'w.js'], port: 'web' }] }, { project: 'demo', env: 'dev' });
  assert.deepEqual(named.problems, []);
  assert.deepEqual(basePortProblems(named.config!).map((problem) => problem.at), ['ports.pg']);
  const native = normalizeLocal({ basePort: 3100, ports: { storage: 3110 }, services: [{ name: 'db', wait: 'healthy' }], processes: [{ name: 'storage', argv: ['node', 's.js'], port: 'storage' }] }, { project: 'demo', env: 'dev' });
  assert.deepEqual(basePortProblems(native.config!), [], 'a native process named storage is a further native process');
});

test('a compose file publishes its host ports from local.ports: a literal host port is found, a variable or a container-only port is not', () => {
  assert.deepEqual(literalPublishes({
    db: { ports: ['127.0.0.1:${STACK_PORT_DB}:5432'] },
    ingress: { ports: ['127.0.0.1:3080:3080', '8443'] },
    legacy: { ports: ['3001:3001', { target: 9000, published: 9000 }, '[::1]:7000:7000/tcp'] },
  }), [
    { service: 'ingress', entry: '127.0.0.1:3080:3080' },
    { service: 'legacy', entry: '3001:3001' },
    { service: 'legacy', entry: 'published: 9000' },
    { service: 'legacy', entry: '[::1]:7000:7000/tcp' },
  ]);
});

test('other compose ports and processes without a port are exempt, and an app with no base is not judged', () => {
  assert.deepEqual(problems({ web: 3100, api: 3101 }, 3100), []);
  const withContainers = block({ web: 3100 }, { basePort: 3100, containers: { redis: 56379, minio: 59000 } });
  assert.deepEqual(basePortProblems(withContainers.config!), []);
  assert.deepEqual(basePortProblems(block({ web: 3100 }, { containers: { db: 54322, mail: 1025 } }).config!), []);
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
const processesBlock = (ports: string, processes: string[], base = ''): string => `${base}      ports: {cache: 56379, ${ports}}\n      services: [{name: db, wait: healthy}]\n      processes:\n${processes.map((name) => `        - {name: ${name}, argv: [node, ${name}.js], port: ${name}}\n`).join('')}`;

test('R389 a layout that follows the role table raises nothing; one off it is STACKS_BASE_PORT_ROLE, an error naming the port', (t) => {
  assert.deepEqual(findings(app(t, processesBlock('web: 3100, api: 3101, gateway: 3102, mcp: 3103, landing: 3104', ['web', 'api', 'gateway', 'mcp', 'landing'], '      basePort: 3100\n'))), []);
  const off = findings(app(t, processesBlock('web: 3100, api: 3102', ['web', 'api'], '      basePort: 3100\n')));
  assert.deepEqual(off.map((finding) => [finding.code, finding.level]), [['STACKS_BASE_PORT_ROLE', 'error']]);
  assert.match(off[0]?.message ?? '', /environments\.dev\.local\.processes\.api: is the api: basePort \+ 1 = 3101, not 3102 \(basePort 3100/u);
});

test('R389 pass and fail fixtures of the compose ports: on their slots and published from local.ports raises nothing; off a slot is STACKS_COMPOSE_PORT_ROLE, a literal publish STACKS_COMPOSE_PORT_LITERAL', (t) => {
  const compose = (root: string, text: string): void => fs.writeFileSync(path.join(root, '.starcistacks', 'dev', 'infra', 'compose', 'compose.yaml'), text);
  const lawful = app(t, '      basePort: 3100\n      ports: {web: 3100, mail: 3191, mailui: 3192, storage: 3193, storage-console: 3194}\n      services: [{name: db, wait: healthy}]\n      processes:\n        - {name: web, argv: [node, web.js], port: web}\n');
  compose(lawful, 'services:\n  db:\n    image: postgres\n  storage:\n    image: minio\n    ports:\n      - "127.0.0.1:${STACK_PORT_STORAGE}:9000"\n');
  assert.deepEqual(findings(lawful), []);
  const fixed = app(t, '      basePort: 3100\n      ports: {web: 3100, mail: 1025, mailui: 8025}\n      services: [{name: db, wait: healthy}]\n      processes:\n        - {name: web, argv: [node, web.js], port: web}\n');
  compose(fixed, 'services:\n  db:\n    image: postgres\n  edge:\n    image: caddy\n    ports:\n      - "127.0.0.1:3080:3080"\n');
  const found = findings(fixed);
  assert.deepEqual(found.map((finding) => [finding.code, finding.level]), [['STACKS_COMPOSE_PORT_ROLE', 'error'], ['STACKS_COMPOSE_PORT_ROLE', 'error'], ['STACKS_COMPOSE_PORT_LITERAL', 'error']]);
  assert.match(found[0]?.message ?? '', /environments\.dev\.local\.ports\.mail: is the mail compose port: basePort \+ 91 = 3191, not 1025 \(basePort 3100/u);
  assert.match(found[2]?.message ?? '', /services\.edge\.ports publishes "127\.0\.0\.1:3080:3080", a literal host port the base port cannot move/u);
  assert.equal(found[2]?.path, '.starcistacks/dev/infra/compose/compose.yaml');
  const unbased = app(t, '      ports: {mail: 1025}\n      services: [{name: db, wait: healthy}]\n');
  compose(unbased, 'services:\n  db:\n    image: postgres\n    ports:\n      - "127.0.0.1:5432:5432"\n');
  assert.deepEqual(findings(unbased), [], 'no base declared: nothing to derive from');
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

const BASE_APP = (base: number | null): string => `${base === null ? '' : `      basePort: ${base}\n`}      ports: {cache: 56379, web: ${base ?? 3000}}\n      services: [{name: db, wait: healthy}]\n      processes:\n        - {name: web, argv: [node, web.js], port: web}\n`;

function localOf(root: string, basePort: number | null, ports: Record<string, number> = { web: basePort ?? 3000 }): LocalConfig {
  const { config } = normalizeLocal({ ...(basePort === null ? {} : { basePort }), ports: { cache: 56379, ...ports }, services: [{ name: 'db', wait: 'healthy' }], processes: Object.keys(ports).map((name) => ({ name, argv: ['node', 'x.js'], port: name })) }, { project: 'demo', env: 'dev' });
  return { ...config!, env: 'dev', appProject: 'demo', repoRoot: root, envDir: root, composeFiles: [], secretsDir: root };
}

const found = (peers: PeerBase[], unread: MachinePeers['unread'] = []): MachinePeers => ({ peers, unread, registries: ['D:/state/machine.sqlite'] });

test('doctor rows: the role table and the range are ok rows naming every project compared; a table violation and an overlap are fail rows', () => {
  const peers: PeerBase[] = [{ project: 'neighbour', repoRoot: 'D:/apps/neighbour', basePort: 3100 }, { project: 'other', repoRoot: 'D:/apps/other', basePort: 4000 }];
  const clear = basePortRows(localOf('x', 3300), found(peers));
  assert.deepEqual(clear.map((row) => [row.id, row.ok]), [['base port', true], ['port range', true]]);
  assert.equal(clear[1]?.detail, '3300..3399 overlaps no other project; compared neighbour 3100..3199 (D:/apps/neighbour); other 4000..4099 (D:/apps/other); registries D:/state/machine.sqlite');
  const clash = basePortRows(localOf('x', 3050), found(peers));
  assert.deepEqual(clash.map((row) => [row.id, row.ok]), [['base port', true], ['port range', false]]);
  assert.match(clash[1]?.detail ?? '', /^3050\.\.3149 overlaps neighbour 3100\.\.3199 \(D:\/apps\/neighbour\); compared /u);
  assert.match(clash[1]?.fix ?? '', /each project owns its own hundred: change local\.basePort to 3200, the next free base/u);
  assert.equal(basePortRows(localOf('x', 3100), found(peers))[1]?.ok, false, 'equal bases overlap');
  assert.equal(basePortRows(localOf('x', 3200), found(peers))[1]?.ok, true, 'bases a span apart do not');
  const off = basePortRows(localOf('x', 3300, { web: 3301 }), found(peers));
  assert.equal(off[0]?.ok, false);
  assert.match(off[0]?.detail ?? '', /processes\.web is the primary front end: basePort = 3300, not 3301/u);
  const none = basePortRows(localOf('x', null), found(peers));
  assert.deepEqual(none.map((row) => [row.id, row.ok]), [['base port', true]], 'no base declared: one ok row asking for it, no overlap to judge');
  const alone = basePortRows(localOf('x', 3300), { peers: [], unread: [], registries: [] });
  assert.equal(alone[1]?.detail, '3300..3399 overlaps no other project; compared no other project; no machine registry found');
});

test('a project that declares no base holds the ports it declares: a base whose hundred contains one of them overlaps it', () => {
  const legacy: PeerBase = { project: 'legacy', repoRoot: 'D:/lanes/legacy', basePort: null, ports: [3100, 3103, 3105, 18787] };
  const rows = basePortRows(localOf('x', 3105, { web: 3105 }), found([legacy]));
  assert.equal(rows[1]?.ok, false);
  assert.match(rows[1]?.detail ?? '', /^3105\.\.3204 overlaps legacy no basePort, ports 3100, 3103, 3105, 18787 \(D:\/lanes\/legacy\)/u);
  assert.deepEqual(overlapsOf(3200, [legacy]), []);
  assert.equal(nextFreeBase(3100, [legacy]), 3200);
  const unread = basePortRows(localOf('x', 3300), found([], [{ repoRoot: 'D:/gone', why: 'the checkout no longer exists' }]));
  assert.match(unread[1]?.detail ?? '', /not read: D:\/gone \(the checkout no longer exists\)$/u);
});

const git = (cwd: string, ...args: string[]): void => { assert.equal(spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).status, 0, args.join(' ')); };

test('machinePeers reads every registered project from the fake machine store, with its worktrees: one per project, never this app, retired ones left out, the unreadable named', (t) => {
  const registry = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-base-port-registry-'));
  t.after(() => fs.rmSync(registry, { recursive: true, force: true }));
  const env = { STARCI_LOCAL_ROOT: registry } as NodeJS.ProcessEnv;
  const file = path.join(registry, 'machine.sqlite');
  const own = app(t, BASE_APP(3000));
  const lane = app(t, BASE_APP(3000));
  // A project whose registered checkout declares no base, while a lane worktree of it does: the lane's base is the project's.
  const neighbour = app(t, BASE_APP(null), 'neighbour');
  git(neighbour, 'init', '-q', '-b', 'main');
  git(neighbour, '-c', 'user.email=spec@example.invalid', '-c', 'user.name=spec', 'add', '-A');
  git(neighbour, '-c', 'user.email=spec@example.invalid', '-c', 'user.name=spec', 'commit', '-qm', 'base');
  const neighbourLane = `${neighbour}-lane`;
  t.after(() => fs.rmSync(neighbourLane, { recursive: true, force: true }));
  git(neighbour, 'worktree', 'add', '-q', '-b', 'lane', neighbourLane);
  fs.writeFileSync(path.join(neighbourLane, '.starcistacks', 'application-stacks.yaml'), `schema: starci/application-stacks@1\nenvironments:\n${COMPOSE_ENV(BASE_APP(3100))}`);
  const legacy = app(t, BASE_APP(null), 'legacy');
  const retired = app(t, BASE_APP(3500), 'gone');
  const missing = path.join(registry, 'no-such-checkout');
  const registered = [own, lane, neighbour, legacy, retired, missing];
  withMachine((m) => {
    registered.forEach((root, index) => m.registerLedger({ ledgerId: `ledger-${index}`, name: path.basename(root), repoRoot: root, file: path.join(registry, `ledger-${index}.sqlite`) }));
    m.setLedgerState('ledger-4', 'retired', { reason: 'spec' });
  }, { file, env });
  assert.deepEqual(machineRegistries(env, own), [path.resolve(file)], 'STARCI_LOCAL_ROOT pins one store: the harness home is not read');
  const result = machinePeers({ env }, { repoRoot: own, appProject: 'demo', env: 'dev' });
  assert.deepEqual(Object.fromEntries(result.peers.map((peer) => [peer.project, [peer.basePort, peer.ports]])), { neighbour: [3100, []], legacy: [null, [56379, 3000]] });
  assert.deepEqual(result.unread.map((entry) => [entry.repoRoot, entry.why]), [[path.resolve(missing), 'the checkout no longer exists']]);
  assert.deepEqual(result.registries, [path.resolve(file)]);
  const staging = machinePeers({ env }, { repoRoot: own, appProject: 'demo', env: 'staging' });
  assert.deepEqual(staging.peers.map((peer) => [peer.basePort, peer.ports]), [[null, []], [null, []]], 'another environment name declares neither base nor ports');
  assert.deepEqual(machinePeers({ env: { STARCI_LOCAL_ROOT: path.join(registry, 'empty') } as NodeJS.ProcessEnv }, { repoRoot: own, appProject: 'demo', env: 'dev' }), { peers: [], unread: [], registries: [] }, 'no registry: no peers, no failure');
});

test('the harness home of an app is the nearest ancestor that is a harness checkout or holds one as .claude', (t) => {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-harness-home-'));
  t.after(() => fs.rmSync(top, { recursive: true, force: true }));
  const home = path.join(top, '.claude');
  for (const dir of ['cli', 'ops', 'policy']) fs.mkdirSync(path.join(home, dir), { recursive: true });
  fs.writeFileSync(path.join(home, 'ops', 'checks.yaml'), '');
  fs.writeFileSync(path.join(home, 'policy', 'quality.yaml'), '');
  fs.mkdirSync(path.join(top, 'apps', 'shop'), { recursive: true });
  assert.equal(harnessHomeOf(path.join(top, 'apps', 'shop')), home);
  assert.equal(harnessHomeOf(home), home);
  fs.mkdirSync(path.join(home, '.runtime'));
  fs.writeFileSync(path.join(home, '.runtime', 'machine.sqlite'), '');
  const env = { LOCALAPPDATA: path.join(top, 'appdata') } as NodeJS.ProcessEnv;
  assert.ok(machineRegistries(env, path.join(top, 'apps', 'shop')).includes(path.join(home, '.runtime', 'machine.sqlite')), 'an installed CLI also reads the harness home registry, where the projects are registered');
});

test('the scaffold base: the name base when free, else the next free hundred said so; --base-port is refused HFS_SCAFFOLD_BASE_PORT_TAKEN with the next free base', () => {
  const name = 'alpha';
  const preferred = scaffoldBasePort(name);
  const free = scaffoldBase({ name, root: 'D:/apps/alpha', found: found([]) });
  assert.deepEqual(free, { port: preferred, line: `base port: ${preferred} (the name's base, free; compared no other project)` });
  const holder: PeerBase = { project: 'neighbour', repoRoot: 'D:/apps/neighbour', basePort: preferred };
  const moved = scaffoldBase({ name, root: 'D:/apps/alpha', found: found([holder]) });
  assert.notEqual(moved.port, preferred);
  assert.equal(overlapsOf(moved.port, [holder]).length, 0);
  assert.match(moved.line, new RegExp(`^base port: ${moved.port} \\(the name's base ${preferred} overlaps neighbour ${preferred}\\.\\.${preferred + 99} \\(D:/apps/neighbour\\): the next free hundred; compared neighbour`, 'u'));
  assert.throws(() => scaffoldBase({ name, root: 'D:/apps/alpha', explicit: String(preferred + 50), found: found([holder]) }), (error: unknown) => {
    assert.ok(error instanceof ScaffoldError);
    assert.equal(error.code, 'HFS_SCAFFOLD_BASE_PORT_TAKEN');
    assert.match(error.message, new RegExp(`^--base-port ${preferred + 50} \\(${preferred + 50}\\.\\.${preferred + 149}\\) overlaps neighbour .*each project owns its own hundred \\(PROJECT-STACKS-10\\); the next free base is \\d+: run starci app scaffold alpha --base-port \\d+`, 'u'));
    return true;
  });
  const elsewhere = preferred === 4800 ? 4700 : 4800;
  assert.deepEqual(scaffoldBase({ name, root: 'D:/apps/alpha', explicit: String(elsewhere), found: found([holder]) }).port, elsewhere, 'a named base no project holds is taken');
  assert.throws(() => scaffoldBase({ name, root: 'D:/apps/alpha', explicit: '3950', found: found([]) }), /overlaps the shared UI-lane preview/u);
});

test('the preview range 3900..3999 is reserved: a base whose range overlaps it fails a doctor row', () => {
  assert.equal(overlapsReserved(3900), true);
  assert.equal(overlapsReserved(3850), true);
  assert.equal(overlapsReserved(3999), true);
  assert.equal(overlapsReserved(3800), false);
  assert.equal(overlapsReserved(4000), false);
  const rows = basePortRows(localOf('x', 3850, { web: 3850 }), found([]));
  assert.deepEqual(rows.map((row) => [row.id, row.ok]), [['base port', true], ['port range reserved', false], ['port range', true]]);
  assert.match(rows[1]?.detail ?? '', /3850\.\.3949 overlaps 3900\.\.3999, reserved for the shared UI-lane next dev preview/u);
});

test('the scaffold starts a new app on a base of its own in 3000..4900, in steps of the span', () => {
  const bases = new Set(['alpha', 'beta', 'gamma', 'delta', 'demo', 'example-app', 'shop'].map(scaffoldBasePort));
  for (const base of bases) assert.ok(base >= 3000 && base <= 4900 && base % 100 === 0 && !overlapsReserved(base), String(base));
  for (let i = 0; i < 200; i += 1) assert.ok(!overlapsReserved(scaffoldBasePort(`app-${i}`)), `app-${i}`);
  assert.ok(bases.size > 1, 'the base follows the project name');
  assert.equal(scaffoldBasePort('alpha'), scaffoldBasePort('alpha'));
});

/** A temp machine store (STARCI_LOCAL_ROOT) that registers `roots`: the registry the overlap judgements read, never the host's. */
function registryOf(t: { after: (fn: () => void) => void }, roots: readonly string[]): NodeJS.ProcessEnv {
  const registry = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-base-port-registry-'));
  t.after(() => fs.rmSync(registry, { recursive: true, force: true }));
  const env = { ...process.env, STARCI_LOCAL_ROOT: registry } as NodeJS.ProcessEnv;
  withMachine((m) => roots.forEach((root, index) => m.registerLedger({ ledgerId: `ledger-${index}`, name: path.basename(root), repoRoot: root, file: path.join(registry, `ledger-${index}.sqlite`) })), { file: path.join(registry, 'machine.sqlite'), env });
  return env;
}

test('app check --env local reports an overlap with another registered project as STACK_BASE_PORT_OVERLAP, a warning naming it and the next free base; a free range is one line', async (t) => {
  const other = app(t, BASE_APP(3000), 'neighbour');
  const clashing = app(t, BASE_APP(3000));
  const env = registryOf(t, [other, clashing]);
  const ctx = stackContext({ cwd: clashing, env });
  const judged = await liveStateFindings({ ctx, repoRoot: clashing });
  assert.deepEqual(judged.findings.map((finding) => [finding.code, finding.level, finding.path]), [['STACK_BASE_PORT_OVERLAP', 'warning', '.starcistacks/application-stacks.yaml']]);
  assert.match(judged.findings[0]?.message ?? '', /^environments\.dev\.local\.basePort: 3000\.\.3099 overlaps neighbour 3000\.\.3099 \(.+\); compared neighbour .*each project owns its own hundred: change local\.basePort to 3100, the next free base, .*starci app stack up --env dev refuses to start on it \(STACK_LOCAL_BASE_PORT_TAKEN\)$/u);
  assert.match(judged.lines.join('\n'), /^ {2}machine dev: base-port-overlap 1 project\(s\) \(3000\.\.3099 overlaps neighbour/mu);
  const apart = app(t, BASE_APP(3100));
  const clear = await liveStateFindings({ ctx: stackContext({ cwd: apart, env: registryOf(t, [other, apart]) }), repoRoot: apart });
  assert.deepEqual(clear.findings, []);
  assert.match(clear.lines.join('\n'), /machine dev: base-port-overlap none \(3100\.\.3199 overlaps no other project; compared neighbour 3000\.\.3099/u);
  const unbased = app(t, BASE_APP(null));
  assert.deepEqual(await liveStateFindings({ ctx: stackContext({ cwd: unbased, env: registryOf(t, [other, unbased]) }), repoRoot: unbased }), { findings: [], lines: [] }, 'no base declared: R389 asks for one, nothing to compare');
  assert.equal(failureCatalog().STACK_BASE_PORT_OVERLAP?.kind, 'check-finding');
});

test('stack up refuses STACK_LOCAL_BASE_PORT_TAKEN before anything starts, dry run and --execute alike, naming the other project and the next free base', async (t) => {
  const other = app(t, BASE_APP(3000), 'neighbour');
  const clashing = app(t, BASE_APP(3000));
  const env = registryOf(t, [other, clashing]);
  const local = { ...loadLocalConfig({ repoRoot: clashing, env: 'dev' }) };
  const started: string[] = [];
  const ctx = { ...stackContext({ cwd: clashing, env }), spawn: (command: string) => { started.push(command); return { status: 0, stdout: '', stderr: '' }; } } as unknown as StackContext;
  for (const execute of [false, true]) {
    await assert.rejects(upLocal(ctx, local, { execute }), (error: { code?: string; message?: string }) => {
      assert.equal(error.code, 'STACK_LOCAL_BASE_PORT_TAKEN');
      assert.match(error.message ?? '', /^STACK_LOCAL_BASE_PORT_TAKEN: dev: 3000\.\.3099 overlaps neighbour 3000\.\.3099 \(.+\); compared neighbour .*; nothing was started: each project owns its own hundred: change local\.basePort to 3100, the next free base, and the ports that derive from it/u);
      return true;
    });
  }
  assert.deepEqual(started, [], 'refused before the host preflight runs a single command');
  assert.equal(failureCatalog().STACK_LOCAL_BASE_PORT_TAKEN?.kind, 'verb-refusal');
});
