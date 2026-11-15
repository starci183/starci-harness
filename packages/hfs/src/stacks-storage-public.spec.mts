/** A dev object store is reachable through a public route on the dev tunnel, and the app builds links on that origin (PROJECT-STACKS-15, R428). */
// proves: STORAGE_PUBLIC_ROUTE_MISSING@lite
// proves: STORAGE_PUBLIC_ROUTE_MISSING@full
// proves: STORAGE_PUBLIC_ROUTE_CONSOLE@lite
// proves: STORAGE_PUBLIC_ROUTE_CONSOLE@full
// proves: STORAGE_PUBLIC_LINK_INTERNAL@lite
// proves: STORAGE_PUBLIC_LINK_INTERNAL@full
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLocal } from '../runtime/scripts/hfs/stack-local-config.mjs';
import { storagePublicFindings } from '../runtime/scripts/hfs/rules/stacks-storage-public.mjs';

// reason: stack declarations are YAML-shaped trees the assertions build and judge.
type Json = any;
const codes = (doc: Json): string[] => storagePublicFindings(doc).map((finding) => finding.code);

/** The smallest example of PROJECT-STACKS-15: one object store, one tunnel route, the api with its two values. */
const local = (): Json => ({
  ports: { api: 4301, storage: 4393, 'storage-console': 4394 },
  services: [{ name: 'storage', wait: 'tcp', port: 'storage', kind: 'object-store', console: 'storage-console' }],
  tunnel: { name: 'demo-dev', routes: [{ name: 'storage', host: 'demo-local-files.example.org', port: 'storage' }] },
  processes: [{
    name: 'api', argv: ['node', 'dist/main.js'], port: 'api',
    env: { STORAGE_ENDPOINT: 'http://127.0.0.1:${port.storage}', STORAGE_PUBLIC_URL: 'https://demo-local-files.example.org' },
  }],
});
const stack = (mutate: (block: Json) => void = () => undefined, data: Json = undefined): Json => {
  const block = local();
  mutate(block);
  return { environments: { dev: { runtime: 'docker-compose', local: block }, production: { runtime: 'docker-swarm' } }, ...(data === undefined ? {} : { data }) };
};

test('the smallest example is green; production and an environment with no store are not judged', () => {
  assert.deepEqual(codes(stack()), []);
  assert.deepEqual(codes({ environments: { dev: { runtime: 'docker-compose', local: { ...local(), services: [{ name: 'db', wait: 'healthy' }] } } } }), []);
  assert.deepEqual(codes({}), []);
});

test('a public-facing dev environment with an object store and no route is STORAGE_PUBLIC_ROUTE_MISSING', () => {
  assert.deepEqual(codes(stack((block) => { block.tunnel.routes = [{ name: 'web', host: 'demo-local.example.org', port: 'api' }]; })), ['STORAGE_PUBLIC_ROUTE_MISSING', 'STORAGE_PUBLIC_LINK_INTERNAL']);
});

test('an environment that publishes nothing keeps its loopback links (the rule starts with the first public origin)', () => {
  const quiet = stack((block) => { delete block.tunnel; delete block.processes[0].env.STORAGE_PUBLIC_URL; });
  assert.deepEqual(codes(quiet), []);
  const published = stack((block) => { delete block.tunnel; block.processes[0].env.SITE_URL = 'https://demo.example.org'; });
  assert.deepEqual(codes(published), ['STORAGE_PUBLIC_ROUTE_MISSING', 'STORAGE_PUBLIC_LINK_INTERNAL']);
});

test('the store is found through data.stores too: a storage component is an object store without the kind', () => {
  const bare = stack((block) => { block.services = [{ name: 'minio', wait: 'tcp', port: 'storage' }]; block.tunnel.routes = [{ name: 'web', host: 'demo-local.example.org', port: 'api' }]; delete block.processes[0].env; },
    { stores: [{ id: 'storage', kind: 'storage', level: 'logical', component: 'minio' }] });
  assert.deepEqual(codes(bare), ['STORAGE_PUBLIC_ROUTE_MISSING']);
});

test('a route to the admin console is STORAGE_PUBLIC_ROUTE_CONSOLE', () => {
  const found = codes(stack((block) => { block.tunnel.routes.push({ name: 'console', host: 'demo-local-console.example.org', port: 'storage-console' }); }));
  assert.deepEqual(found, ['STORAGE_PUBLIC_ROUTE_CONSOLE']);
});

test('STORAGE_PUBLIC_LINK_INTERNAL: no public base, a loopback or container host, or a host no route serves', () => {
  const withUrl = (value: string | undefined): string[] => codes(stack((block) => { if (value === undefined) delete block.processes[0].env.STORAGE_PUBLIC_URL; else block.processes[0].env.STORAGE_PUBLIC_URL = value; }));
  assert.deepEqual(withUrl(undefined), ['STORAGE_PUBLIC_LINK_INTERNAL']);
  for (const bad of ['http://127.0.0.1:${port.storage}', 'http://localhost:4393', 'http://storage:9000', 'https://other.example.org', 'https://demo-local-files.example.org/bucket']) assert.deepEqual(withUrl(bad), ['STORAGE_PUBLIC_LINK_INTERNAL'], bad);
  assert.deepEqual(withUrl('https://demo-local-files.example.org/'), []);
});

test('local.tunnel and the service fields are judged by the one normaliser (R340): a loopback host, an unknown port, a twin host, a console outside an object store', () => {
  const problems = (mutate: (block: Json) => void): string[] => { const block = local(); mutate(block); return normalizeLocal(block, { project: 'demo', env: 'dev' }).problems.map((problem) => problem.at); };
  assert.deepEqual(problems(() => undefined), []);
  assert.deepEqual(problems((block) => { block.tunnel.routes[0].host = '127.0.0.1'; }), ['tunnel.routes[0].host']);
  assert.deepEqual(problems((block) => { block.tunnel.routes[0].host = 'localhost'; }), ['tunnel.routes[0].host']);
  assert.deepEqual(problems((block) => { block.tunnel.routes[0].port = 'nope'; }), ['tunnel.routes[0].port']);
  assert.deepEqual(problems((block) => { block.tunnel.routes.push({ ...block.tunnel.routes[0], name: 'again' }); }), ['tunnel.routes[1].host']);
  assert.deepEqual(problems((block) => { block.tunnel.routes = []; }), ['tunnel.routes']);
  assert.deepEqual(problems((block) => { block.services.push({ name: 'db', wait: 'healthy', console: 'api' }); }), ['services[1].console']);
  assert.deepEqual(problems((block) => { block.services[0].kind = 'bucket'; }), ['services[0].kind', 'services[0].console']);
});

test('the ingress file gets the missing host before its catch-all and nothing else changes; a host routed elsewhere is a refusal', async () => {
  const { withRoutes } = await import('../stack/local-tunnel.mjs');
  const file = 'tunnel: abc\ncredentials-file: x.json\ningress:\n  - hostname: demo-local.example.org\n    service: http://127.0.0.1:4301\n  - service: http_status:404\n';
  const wanted = [{ host: 'demo-local.example.org', service: 'http://127.0.0.1:4301' }, { host: 'demo-local-files.example.org', service: 'http://127.0.0.1:4393' }];
  const next = withRoutes(file, wanted, 'demo-dev.yml');
  assert.deepEqual(next.added, ['demo-local-files.example.org']);
  assert.equal(next.text, 'tunnel: abc\ncredentials-file: x.json\ningress:\n  - hostname: demo-local.example.org\n    service: http://127.0.0.1:4301\n  - hostname: demo-local-files.example.org\n    service: http://127.0.0.1:4393\n  - service: http_status:404\n');
  assert.equal(withRoutes(next.text, wanted, 'demo-dev.yml').text, next.text);
  assert.throws(() => withRoutes(file, [{ host: 'demo-local.example.org', service: 'http://127.0.0.1:9999' }], 'demo-dev.yml'), { code: 'STACK_LOCAL_TUNNEL_CONFLICT' });
  assert.throws(() => withRoutes('ingress:\n  - hostname: a.example.org\n    service: http://127.0.0.1:1\n', wanted, 'demo-dev.yml'), { code: 'STACK_LOCAL_TUNNEL_CONFIG' });
});

test('the DNS record is routed to the declared tunnel: its own ingress file and its id, never the default config.yml of the home', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { routeTunnel, tunnelRows } = await import('../stack/local-tunnel.mjs');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-tunnel-'));
  try {
    fs.writeFileSync(path.join(home, 'cert.pem'), 'not a certificate');
    // The home's default file names ANOTHER tunnel of the machine: a route made without --config lands there.
    fs.writeFileSync(path.join(home, 'config.yml'), 'tunnel: 99999999-0000-0000-0000-000000000000\ningress:\n  - service: http_status:404\n');
    const own = path.join(home, 'demo-dev.yml');
    fs.writeFileSync(own, 'tunnel: 2ce9c0e0-1111-2222-3333-444444444444\ncredentials-file: x.json\ningress:\n  - service: http_status:404\n');
    const config = normalizeLocal(local(), { project: 'demo', env: 'dev' }).config as Json;
    const calls: string[][] = [];
    let answer = 'INF Added CNAME demo-local-files.example.org which will route to this tunnel tunnelID=2ce9c0e0-1111-2222-3333-444444444444';
    const ctx: Json = {
      env: { CLOUDFLARED_HOME: home },
      spawn: (command: string, args: string[]) => { calls.push([command, ...args]); return { status: 0, stdout: '', stderr: answer }; },
      fetch: async () => ({ status: 200 }),
    };
    const lines = await routeTunnel(ctx, config);
    assert.deepEqual(calls, [['cloudflared', '--config', own, 'tunnel', 'route', 'dns', '--overwrite-dns', '2ce9c0e0-1111-2222-3333-444444444444', 'demo-local-files.example.org']]);
    assert.ok(lines.some((line: string) => line.includes('DNS routes demo-local-files.example.org to the tunnel 2ce9c0e0-1111-2222-3333-444444444444')));
    answer = 'INF demo-local-files.example.org is already configured to route to your tunnel tunnelID=99999999-0000-0000-0000-000000000000';
    await assert.rejects(routeTunnel(ctx, config), { code: 'STACK_LOCAL_TUNNEL_DNS' });
    fs.writeFileSync(own, 'credentials-file: x.json\ningress:\n  - service: http_status:404\n');
    await assert.rejects(routeTunnel(ctx, config), { code: 'STACK_LOCAL_TUNNEL_CONFIG' });
    const row = tunnelRows(ctx, config).find((entry: Json) => entry.id === 'tunnel demo-dev');
    assert.equal(row?.ok, false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
