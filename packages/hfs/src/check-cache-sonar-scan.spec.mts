// R386: a whole `starci app check` runs the app's CI sonar job against the server: the scanner with the app's own properties, the quality gate the
// server holds for the project, a scanner failure or a red gate an error, an unavailable token, server or permission a warning and never a green. The server is a
// double over fetch; the scanner is a double over the heavy command port.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempRoot } from '../runtime/engine/temp-root.mjs';
import { GATE_FAILED, SCAN_FAILED, SCAN_SKIPPED, localBranchOf, localKeyOf, propertiesOf, runSonarScan, scanKey } from '../cache/sonar-scan-family.mjs';
import type { ParityRun } from '../cache/parity-family.mjs';
import type { ContentIndex } from '../cache/types.mjs';

const TOKEN = 'fixture-analysis-token-value';
const HOST = 'https://quality.example.invalid';
const DECLARATION = `services:
  sonar:
    provider: sonarqube
    mode: hosted
    host:
      public: ${HOST}
    auth: token
    projects:
      - repository: product
        key: product:key
    credentials:
      - id: analysis
        project: product:key
        key: SONAR_TOKEN
        custody:
          repository: product
          path: .starcistacks/dev/secrets/sonar.enc.yaml
    ci:
      token: SONAR_TOKEN
      secrets:
        - name: SONAR_TOKEN
          credential: analysis
environments:
  dev: {}
`;

const app = (t: TestContext, { properties = 'sonar.projectKey=product:key\nsonar.javascript.lcov.reportPaths=be/coverage/lcov.info\n', declaration = DECLARATION }: { properties?: string | null; declaration?: string | null } = {}) => {
  const root = fs.mkdtempSync(path.join(tempRoot(), 'hfs-sonar-scan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'product', version: '1.0.0' }));
  if (properties !== null) fs.writeFileSync(path.join(root, 'sonar-project.properties'), properties);
  if (declaration !== null) {
    fs.mkdirSync(path.join(root, '.starcistacks/dev/secrets'), { recursive: true });
    fs.writeFileSync(path.join(root, '.starcistacks/application-stacks.yaml'), declaration);
    fs.writeFileSync(path.join(root, '.starcistacks/dev/secrets/sonar.enc.yaml'), 'SONAR_TOKEN: ENC[AES256_GCM,data:AA==,iv:AA==,tag:AA==,type:str]\nsops:\n  version: 3.13.2\n');
  }
  return root;
};

const index: ContentIndex = { paths: ['be/a.ts', '.starcistacks/cache/fingerprint.jsonl'], hashOf: (file) => `hash-${file}` };

interface Server { edition?: string; projects?: Set<string>; mainForbidden?: boolean; gateUnreadable?: boolean; createStatus?: number; selectStatus?: number; gate?: 'OK' | 'ERROR'; down?: boolean; log: string[] }
/** A SonarQube server: status, edition, projects with their gate binding, the compute-engine task and the quality gate verdict. */
const server = (state: Server) => async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = new URL(String(input));
  const call = `${init?.method ?? 'GET'} ${url.pathname}${url.search}`;
  state.log.push(call);
  const reply = (status: number, body: unknown = {}): Response => new Response(status === 204 ? null : JSON.stringify(body), { status });
  if (state.down) throw new Error('connect ECONNREFUSED');
  switch (url.pathname) {
    case '/api/system/status': return reply(200, { status: 'UP' });
    case '/api/navigation/global': return reply(200, state.edition === undefined ? {} : { edition: state.edition });
    case '/api/components/show': {
      const key = url.searchParams.get('component') ?? '';
      if (state.mainForbidden === true) return reply(403, { errors: [] });
      return state.projects?.has(key) === true ? reply(200, { component: { key, name: 'Product', visibility: 'private' } }) : reply(404, { errors: [] });
    }
    case '/api/projects/create': if (state.createStatus !== undefined && state.createStatus !== 200) return reply(state.createStatus); state.projects?.add(url.searchParams.get('project') ?? ''); return reply(200, {});
    case '/api/qualitygates/get_by_project': if (state.gateUnreadable === true) return reply(403); return reply(200, { qualityGate: { name: url.searchParams.get('project') === 'product:key' ? 'starci-quality' : 'Sonar way' } });
    case '/api/qualitygates/select': return reply(state.selectStatus ?? 204);
    case '/api/qualitygates/show': return reply(200, { conditions: [{ metric: 'new_coverage', op: 'LT', error: '80' }] });
    case '/api/ce/task': return reply(200, { task: { status: 'SUCCESS', analysisId: 'AN-1' } });
    case '/api/qualitygates/project_status': if (url.searchParams.has('projectKey') && state.projects?.has(url.searchParams.get('projectKey') ?? '') !== true && url.searchParams.get('projectKey') !== 'product:key') return reply(state.mainForbidden === true ? 403 : 404); return reply(200, { projectStatus: { status: state.gate ?? 'OK', conditions: state.gate === 'ERROR' ? [{ metricKey: 'new_coverage', status: 'ERROR', comparator: 'LT', errorThreshold: '80', actualValue: '12' }] : [] } });
    default: return reply(404);
  }
};

interface Scanned { argv: readonly string[]; env: NodeJS.ProcessEnv }
const scanner = (root: string, seen: Scanned[], result: { status: number; stdout?: string; stderr?: string } = { status: 0 }): ParityRun => async (request) => {
  seen.push({ argv: request.argv, env: request.env });
  fs.mkdirSync(path.join(root, '.scannerwork'), { recursive: true });
  if (result.status === 0) fs.writeFileSync(path.join(root, '.scannerwork', 'report-task.txt'), `projectKey=x\nserverUrl=${HOST}\nceTaskId=AX-task\ndashboardUrl=${HOST}/dashboard\n`);
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};

const scan = (_t: TestContext, root: string, state: Server, run: ParityRun, { fresh = false, sealed = true }: { fresh?: boolean; sealed?: boolean } = {}) => {
  const cache = path.join(root, '.tool-cache');
  const lintWrites = { count: 0 };
  return {
    lintWrites,
    result: runSonarScan({
      repoRoot: root, env: { USERNAME: 'Dev User', STARCI_CACHE_HOME: cache }, platform: 'linux', index, run, fresh,
      io: { cwd: root, env: {}, stackIo: { fetch: server(state), now: () => 1000, sleep: () => Promise.resolve(), spawn: () => ({ status: 1, stdout: '', stderr: '' }) },
        sops: { decrypt: () => { if (!sealed) throw new Error('no age identity'); return { SONAR_TOKEN: TOKEN }; } } },
      writeLintReport: () => { lintWrites.count += 1; },
    }),
  };
};

test('the properties are read as the scanner reads them and the local target is derived from them', () => {
  assert.deepEqual(propertiesOf('# note\nsonar.projectKey = a:b\n\nsonar.sources=be,fe\nsonar.sources=be\n'), { 'sonar.projectKey': 'a:b', 'sonar.sources': 'be' });
  assert.equal(localKeyOf('a:b'), 'a:b-local');
  assert.equal(localBranchOf('Dev User'), 'local/Dev-User');
  assert.equal(localBranchOf(undefined), 'local/developer');
});

test('an app with no sonar-project.properties or no Sonar service is an info line, never a warning', async (t) => {
  const state: Server = { log: [] };
  const none = await scan(t, app(t, { properties: null }), state, scanner('.', [])).result;
  assert.deepEqual(none.findings, []);
  assert.match(none.lines.join('\n'), /not run, the app has no sonar-project\.properties/u);
  const undeclared = await scan(t, app(t, { declaration: 'environments:\n  dev: {}\n' }), state, scanner('.', [])).result;
  assert.deepEqual(undeclared.findings, []);
  assert.match(undeclared.lines.join('\n'), /declares no Sonar service/u);
  assert.deepEqual(state.log, [], 'no server is asked');
});

test('a token that cannot be opened, or a server that does not answer, is a warning and the scanner never runs', async (t) => {
  const root = app(t);
  const seen: Scanned[] = [];
  const noToken = await scan(t, root, { log: [] }, scanner(root, seen), { sealed: false }).result;
  assert.deepEqual(noToken.findings.map((finding) => [finding.code, finding.level]), [[SCAN_SKIPPED, 'warning']]);
  assert.deepEqual(noToken.lines, ['  sonar scan: skipped, no token or host (warning)'], 'a skip is one line of the run');
  const down = await scan(t, root, { log: [], down: true }, scanner(root, seen)).result;
  assert.deepEqual(down.findings.map((finding) => [finding.code, finding.level]), [[SCAN_SKIPPED, 'warning']]);
  assert.match(down.findings[0]?.message ?? '', /did not report UP/u);
  assert.equal(seen.length, 0);
  assert.doesNotMatch(JSON.stringify([noToken, down]), new RegExp(TOKEN, 'u'));
});

test('a server without branch support gets the derived project, bound to the main project\'s gate, and the main analysis is never named', async (t) => {
  const root = app(t);
  const seen: Scanned[] = [];
  const state: Server = { edition: 'community', projects: new Set(['product:key']), log: [] };
  const { result, lintWrites } = scan(t, root, state, scanner(root, seen));
  const done = await result;
  assert.deepEqual(done.findings, []);
  assert.match(done.lines.join('\n'), /sonar scan: started against project product:key-local \(project key product:key-local\)/u);
  assert.match(done.lines.join('\n'), /sonar scan: quality gate OK against project product:key-local in \d+\.\ds \(project key product:key-local\)/u);
  assert.equal(lintWrites.count, 1);
  assert.ok(state.log.some((call) => call.startsWith('POST /api/projects/create?project=product%3Akey-local')), 'the derived project is created');
  assert.ok(state.log.some((call) => call.startsWith('POST /api/qualitygates/select?gateName=starci-quality&projectKey=product%3Akey-local')), 'bound to the main project\'s gate');
  const argv = seen[0]?.argv.join(' ') ?? '';
  assert.match(argv, /-Dsonar\.projectKey=product:key-local/u);
  assert.doesNotMatch(argv, /-Dsonar\.projectKey=product:key(?!-)/u);
  assert.doesNotMatch(argv, /sonar\.branch\.name/u);
  assert.equal(seen[0]?.env['SONAR_TOKEN'], TOKEN, 'the token reaches the scanner through its environment alone');
  assert.doesNotMatch(argv, new RegExp(TOKEN, 'u'));
});

test('a derived project the token can analyse is scanned as it is: the main project is never read, created or bound', async (t) => {
  const root = app(t);
  const seen: Scanned[] = [];
  const state: Server = { edition: 'community', projects: new Set(['product:key-local']), mainForbidden: true, gateUnreadable: true, log: [] };
  const done = await scan(t, root, state, scanner(root, seen)).result;
  assert.deepEqual(done.findings, []);
  assert.equal(seen.length, 1, 'the scanner ran');
  assert.match(done.lines.join('\n'), /quality gate OK against project product:key-local/u);
  assert.ok(state.log.every((call) => !/component=product%3Akey(&|$)/u.test(call) && !call.includes('/api/projects/create') && !call.includes('/api/qualitygates/select') && !/project=product%3Akey$/u.test(call)), `the main project is not touched: ${state.log.join(', ')}`);
});

test('a derived project whose gate conditions the token reads keeps its verdict by the gate state', async (t) => {
  const root = app(t);
  const seen: Scanned[] = [];
  const state: Server = { edition: 'community', projects: new Set(['product:key-local']), mainForbidden: true, log: [] };
  await scan(t, root, state, scanner(root, seen)).result;
  const again = await scan(t, root, state, scanner(root, seen)).result;
  assert.equal(seen.length, 1, 'the second run reuses the verdict');
  assert.match(again.lines.join('\n'), /reused/u);
});

test('a derived project that is missing, with a token that cannot read the main project, is a clear skip', async (t) => {
  const root = app(t);
  const seen: Scanned[] = [];
  const done = await scan(t, root, { edition: 'community', projects: new Set(), mainForbidden: true, log: [] }, scanner(root, seen)).result;
  assert.deepEqual(done.findings.map((finding) => [finding.code, finding.level]), [[SCAN_SKIPPED, 'warning']]);
  assert.match(done.findings[0]?.message ?? '', /create product:key-local and bind it to the quality gate, or give the token Create Projects/u);
  assert.equal(seen.length, 0);
});

test('a red gate of a derived project the token can analyse is red', async (t) => {
  const root = app(t);
  const done = await scan(t, root, { edition: 'community', projects: new Set(['product:key-local']), mainForbidden: true, gate: 'ERROR', log: [] }, scanner(root, [])).result;
  assert.deepEqual(done.findings.map((finding) => [finding.code, finding.level]), [[GATE_FAILED, 'error']]);
  assert.match(done.findings[0]?.message ?? '', /project product:key-local is red/u);
});

test('a server with branch support gets a local branch of the project itself', async (t) => {
  const root = app(t);
  const seen: Scanned[] = [];
  const state: Server = { edition: 'developer', projects: new Set(['product:key']), log: [] };
  const done = await scan(t, root, state, scanner(root, seen)).result;
  assert.deepEqual(done.findings, []);
  const argv = seen[0]?.argv.join(' ') ?? '';
  assert.match(argv, /-Dsonar\.projectKey=product:key/u);
  assert.match(argv, /-Dsonar\.branch\.name=local\/Dev-User/u);
  assert.ok(!state.log.some((call) => call.includes('/api/projects/create')), 'no derived project');
});

test('a token that may not create the derived project makes a warning and no scan', async (t) => {
  const root = app(t);
  const seen: Scanned[] = [];
  const done = await scan(t, root, { edition: 'community', projects: new Set(['product:key']), createStatus: 403, log: [] }, scanner(root, seen)).result;
  assert.deepEqual(done.findings.map((finding) => finding.code), [SCAN_SKIPPED]);
  assert.match(done.findings[0]?.message ?? '', /may not create project product:key-local/u);
  assert.equal(seen.length, 0);
});

test('a scanner crash is an error that quotes the scanner\'s own last lines without the token', async (t) => {
  const root = app(t);
  const crash = scanner(root, [], { status: 3, stderr: `ERROR Line 15 is out of range ... File has 14 lines\nERROR ${TOKEN} rejected` });
  const done = await scan(t, root, { edition: 'developer', projects: new Set(['product:key']), log: [] }, crash).result;
  assert.deepEqual(done.findings.map((finding) => [finding.code, finding.level]), [[SCAN_FAILED, 'error']]);
  assert.match(done.findings[0]?.message ?? '', /Line 15 is out of range/u);
  assert.doesNotMatch(done.findings[0]?.message ?? '', new RegExp(TOKEN, 'u'));
});

test('a red quality gate is an error naming the failed conditions', async (t) => {
  const root = app(t);
  const done = await scan(t, root, { edition: 'developer', projects: new Set(['product:key']), gate: 'ERROR', log: [] }, scanner(root, [])).result;
  assert.deepEqual(done.findings.map((finding) => [finding.code, finding.level]), [[GATE_FAILED, 'error']]);
  assert.match(done.findings[0]?.message ?? '', /new_coverage LT 80 \(actual 12\)/u);
});

test('a green scan is kept by the scanned content: the same tree is not scanned again, a changed file, --fresh or a failure is', async (t) => {
  const root = app(t);
  const seen: Scanned[] = [];
  const state: Server = { edition: 'developer', projects: new Set(['product:key']), log: [] };
  await scan(t, root, state, scanner(root, seen)).result;
  const again = await scan(t, root, state, scanner(root, seen)).result;
  assert.equal(seen.length, 1, 'the second run reuses the verdict');
  assert.match(again.lines.join('\n'), /reused/u);
  await scan(t, root, state, scanner(root, seen), { fresh: true }).result;
  assert.equal(seen.length, 2, '--fresh scans again');
  const edited = { ...index, hashOf: (file: string) => `changed-${file}` };
  await runSonarScan({ repoRoot: root, env: { USERNAME: 'Dev User', STARCI_CACHE_HOME: path.join(root, '.tool-cache') }, platform: 'linux', index: edited, run: scanner(root, seen), fresh: false, writeLintReport: () => undefined,
    io: { cwd: root, env: {}, stackIo: { fetch: server(state), now: () => 1000, sleep: () => Promise.resolve() }, sops: { decrypt: () => ({ SONAR_TOKEN: TOKEN }) } } });
  assert.equal(seen.length, 3, 'a changed file is scanned');
});

test('the scan key follows the content it scans and ignores the committed cache folder', () => {
  const base = { repoRoot: tempRoot(), properties: {}, propertiesText: 'a=b', target: 'k@@h', gateDigest: 'g', scanner: '@sonar/scan@4.3.0' };
  const key = scanKey({ ...base, index });
  assert.equal(key, scanKey({ ...base, index: { ...index, hashOf: (file) => (file.startsWith('.starcistacks/cache/') ? 'moved' : `hash-${file}`) } }));
  assert.notEqual(key, scanKey({ ...base, index, gateDigest: 'other' }));
  assert.notEqual(key, scanKey({ ...base, index, target: 'k-local@@h' }));
  assert.notEqual(key, scanKey({ ...base, index, propertiesText: 'a=c' }));
});
