import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ciMain } from '../ci/cli.mjs';
import { verifyCi } from '../ci/verify.mjs';
import { serviceBindings, qualityServices, serviceCredentialNames, readCiDeclaration, isValidCiDeclaration } from '../runtime/scripts/hfs/ci-declaration.mjs';
import { repositoryName, identityQueryEnvironment } from '../runtime/scripts/hfs/repo-identity.mjs';
import { readDeclaredSonarKey } from '../sync/sonar-key.mjs';
import { ciWorkflowCommands } from '../sync/ci-commands.mjs';
import { serviceCredentialValue } from '../runtime/scripts/hfs/secret-store.mjs';
import { declareKeys, auditSecrets } from '../runtime/scripts/hfs/secret-standard.mjs';
import { ciCustodyFindings } from '../runtime/scripts/hfs/rules/ci-custody.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

const ENCRYPTED = 'ENC[AES256_GCM,data:AA==,iv:AA==,tag:AA==,type:str]';
const envelope = (keys: string[]) => [...keys.map((key) => `${key}: ${ENCRYPTED}`), 'sops:', '  age:', `    - recipient: age1${'q'.repeat(58)}`,
  '      enc: |', '        -----BEGIN AGE ENCRYPTED FILE-----', '        YWdl', '        -----END AGE ENCRYPTED FILE-----', `  mac: ${ENCRYPTED}`, '  version: 3.13.2', ''].join('\n');
const VALUE = 'synthetic-project-analysis-value';
const MEMBER = '.starcistacks/dev/secrets/sonar.enc.yaml';
const CREDENTIAL = { id: 'analysis', project: 'org:project-a', key: 'PROJECT_ANALYSIS_TOKEN', custody: { repository: 'project-a', path: MEMBER } };
const document = () => ({
  environments: { dev: { runtime: 'docker-compose', secrets: [] } },
  ci: { github: { repository: 'owner/project-a' }, secrets: [{ name: 'SONAR_TOKEN', scope: 'repository' }], vars: [] },
  services: { sonar: { provider: 'sonarqube', mode: 'hosted', auth: 'token', host: { public: 'https://quality.example.invalid' },
    projects: [{ repository: 'project-b', key: 'org:project-b' }, { repository: 'project-a', key: 'org:project-a' }],
    credentials: [structuredClone(CREDENTIAL)], ci: { token: 'SONAR_TOKEN', secrets: [{ name: 'SONAR_TOKEN', credential: 'analysis' }] } } },
});
function fixture(t: TestContext) {
  const root = mkdtemp(t, 'hfs-service-custody-'), doc = document();
  fs.mkdirSync(path.dirname(path.join(root, MEMBER)), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'project-a' }));
  fs.writeFileSync(path.join(root, MEMBER), envelope(['PROJECT_ANALYSIS_TOKEN']));
  const write = () => fs.writeFileSync(path.join(root, '.starcistacks/application-stacks.yaml'), JSON.stringify(doc));
  write();
  return { root, doc, write };
}

test('a service credential explicitly references the selected repository project, independently of id and array order', () => {
  const doc = document(), selected = serviceBindings(doc, 'project-a');
  assert.deepEqual(selected.problems, []);
  assert.equal(selected.bindings[0]?.credential, 'analysis');
  assert.equal(selected.bindings[0]?.projectKey, 'org:project-a');
  assert.equal(qualityServices(doc, { repository: 'project-a' }).sonar.projectKey, 'org:project-a');
  assert.equal(serviceBindings(doc, 'project-b').bindings.length, 0);
});

test('wrong repository, project, undeclared environment, admin identity, mismatched selector and runtime grant never classify as tooling', () => {
  const changes = [
    (doc: ReturnType<typeof document>) => { doc.services.sonar.credentials[0]!.custody.repository = 'project-b'; },
    (doc: ReturnType<typeof document>) => { doc.services.sonar.credentials[0]!.project = 'not-a-project'; },
    (doc: ReturnType<typeof document>) => { doc.services.sonar.credentials[0]!.custody.path = '.starcistacks/unknown/secrets/sonar.enc.yaml'; },
    (doc: ReturnType<typeof document>) => { doc.services.sonar.credentials[0]!.custody.path = '.starcistacks/dev/secrets/other.enc.yaml'; },
    (doc: ReturnType<typeof document>) => { doc.services.sonar.credentials[0]!.id = 'admin'; doc.services.sonar.ci.secrets[0]!.credential = 'admin'; },
    (doc: ReturnType<typeof document>) => { doc.services.sonar.ci.token = 'OTHER_TOKEN'; },
  ];
  for (const change of changes) { const doc = document(); change(doc); assert.equal(serviceBindings(doc, 'project-a').bindings.length, 0); assert.ok(serviceBindings(doc, 'project-a').problems.length); }
  const runtime = { ...document(), environments: { dev: { deploy: { secrets: { grants: [{ service: 'api', from: [{ member: 'sonar', keys: ['PROJECT_ANALYSIS_TOKEN'] }] }] } } } } };
  assert.equal(serviceBindings(runtime, 'project-a').bindings.length, 0);
  const compose = { ...document(), environments: { dev: { runtime: 'docker-compose', secrets: [{ name: 'sonar-token', member: 'sonar', key: 'PROJECT_ANALYSIS_TOKEN', where: 'secrets/sonar' }] } } };
  assert.equal(serviceBindings(compose, 'project-a').bindings.length, 0);
  const whole = { ...document(), environments: { dev: { secrets: [{ name: 'sonar', member: 'sonar' }] } } };
  assert.equal(serviceBindings(whole, 'project-a').bindings.length, 0);
  const operator = document();
  operator.services.sonar.credentials.push({ ...structuredClone(CREDENTIAL), id: 'admin-login', key: 'SONAR_PASSWORD' });
  assert.equal(serviceBindings(operator, 'project-a').bindings.length, 0);
  const required = { services: { sonar: { mode: 'hosted', ci: { wiring: 'required', token: 'SONAR_TOKEN' } } } };
  assert.ok(serviceBindings(required, 'project-a').problems.length);
});

test('service CI set dry-run judges custody but never decrypts, reads stdin, or contacts GitHub; execution streams only the exact key', async (t) => {
  const { root } = fixture(t), out: string[] = [], err: string[] = [], calls: { args: string[]; input: unknown }[] = [];
  let opens = 0, reads = 0;
  const options = { cwd: root, env: {}, inputRedirected: () => false, stdout: (value: string) => out.push(value), stderr: (value: string) => err.push(value),
    sops: { decrypt: () => { opens += 1; return { PROJECT_ANALYSIS_TOKEN: VALUE, OTHER: 'synthetic-unrelated' }; } },
    tools: { spawn: (_command: string, args: string[], spawnOptions: { input?: unknown }) => { calls.push({ args, input: spawnOptions.input }); return { status: 0, stdout: '' }; } } };
  const argv = ['secret', 'set', 'SONAR_TOKEN', '--from-custody', '--repo', 'owner/project-a'];
  assert.equal(await ciMain(argv, options), 0, err.join(''));
  assert.equal(opens, 0); assert.equal(calls.length, 0);
  assert.equal(await ciMain(argv, { ...options, stdin: () => { reads += 1; return 'synthetic-stdin'; } }), 2);
  assert.equal(reads, 0); assert.equal(opens, 0);
  assert.equal(await ciMain([...argv, '--execute'], options), 0, err.join(''));
  assert.equal(opens, 1); assert.equal(calls.length, 1); assert.equal(calls[0]?.input === VALUE, true);
  assert.equal([...out, ...err].join('').includes(VALUE), false);
  assert.equal(calls[0]?.args.includes(VALUE), false);
});

test('missing, ambiguous, wrong-project or unopenable custody fails without reading stdin or an inherited token', async (t) => {
  const { root, doc, write } = fixture(t), err: string[] = [];
  let opens = 0, contacts = 0, reads = 0;
  const options = { cwd: root, env: { SONAR_TOKEN: 'synthetic-global-fallback' }, inputRedirected: () => false, stderr: (value: string) => err.push(value), stdout: () => {},
    sops: { decrypt: () => { opens += 1; throw new Error('synthetic-private-diagnostic'); } },
    tools: { spawn: () => { contacts += 1; return { status: 0, stdout: '' }; } } };
  const argv = ['secret', 'set', 'SONAR_TOKEN', '--from-custody', '--repo', 'owner/project-a', '--execute'];
  assert.equal(await ciMain(argv, options), 2);
  assert.equal(opens, 1); assert.equal(contacts, 0);
  assert.equal(err.join('').includes('synthetic-private-diagnostic'), false);
  doc.services.sonar.credentials[0]!.custody.repository = 'project-b'; write();
  assert.equal(await ciMain(argv, { ...options, stdin: () => { reads += 1; return VALUE; } }), 2);
  assert.equal(reads, 0); assert.equal(contacts, 0);
  doc.services.sonar.credentials[0]!.custody.repository = 'project-a'; write();
  fs.writeFileSync(path.join(root, '.starcistacks/dev/secrets/sonar.enc'), 'synthetic legacy duplicate');
  assert.equal(await ciMain(argv.slice(0, -1), options), 2);
  fs.unlinkSync(path.join(root, '.starcistacks/dev/secrets/sonar.enc'));
  fs.writeFileSync(path.join(root, MEMBER), envelope(['OTHER_KEY']));
  assert.equal(await ciMain(argv.slice(0, -1), options), 2, 'a known missing key refuses without a decrypt');
  fs.unlinkSync(path.join(root, MEMBER));
  assert.equal(await ciMain(argv.slice(0, -1), options), 2);
});

test('native custody input uses closed stdin; a pipe/file channel refuses without consuming its body', (t) => {
  const { root } = fixture(t);
  const cli = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../ci/cli.mjs')).href;
  const script = `import {ciMain} from ${JSON.stringify(cli)}; let opens=0,contacts=0;
    const code=await ciMain(['secret','set','SONAR_TOKEN','--from-custody','--repo','owner/project-a','--execute'],
      {cwd:${JSON.stringify(root)},env:{},stdout:()=>{},stderr:()=>{},sops:{decrypt:()=>{opens++;return {PROJECT_ANALYSIS_TOKEN:'synthetic-value'};}},tools:{spawn:()=>{contacts++;return {status:0,stdout:''};}}});
    process.stdout.write(JSON.stringify({code,opens,contacts}));`;
  const ignored = spawnSync(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  assert.equal(ignored.status, 0, ignored.stderr);
  assert.deepEqual(JSON.parse(ignored.stdout), { code: 0, opens: 1, contacts: 1 });
  const piped = spawnSync(process.execPath, ['--input-type=module', '-e', script], { input: VALUE, encoding: 'utf8' });
  assert.equal(piped.status, 0, piped.stderr);
  assert.deepEqual(JSON.parse(piped.stdout), { code: 2, opens: 0, contacts: 0 });
  assert.equal(piped.stdout.includes(VALUE), false);
  const emptyPipe = spawnSync(process.execPath, ['--input-type=module', '-e', script], { input: '', encoding: 'utf8' });
  assert.deepEqual(JSON.parse(emptyPipe.stdout), { code: 2, opens: 0, contacts: 0 });
});

test('private endpoint CI renders an explicitly linked secret copy and never needs a public variable or age identity', () => {
  const base = document();
  const doc = { ...base, ci: { ...base.ci, secrets: [...base.ci.secrets, { name: 'PRIVATE_SONAR_HOST', scope: 'repository' }] },
    services: { sonar: { ...base.services.sonar, host: { fromCredential: 'endpoint' },
      credentials: [...base.services.sonar.credentials, { id: 'endpoint', project: 'org:project-a', key: 'PRIVATE_SONAR_URL', custody: { repository: 'project-a', path: '.starcistacks/dev/secrets/sonar-profile.enc.yaml' } }],
      ci: { ...base.services.sonar.ci, hostVar: 'PRIVATE_SONAR_HOST', secrets: [...base.services.sonar.ci.secrets, { name: 'PRIVATE_SONAR_HOST', credential: 'endpoint' }] } } } };
  assert.deepEqual(serviceBindings(doc, 'project-a').problems, []);
  assert.ok(serviceCredentialNames(doc).includes('PRIVATE_SONAR_HOST'));
  const commands = ciWorkflowCommands(undefined, 'be/coverage/lcov.info', qualityServices(doc, { repository: 'project-a' }));
  const rendered = Object.values(commands).join('\n');
  assert.match(rendered, /SONAR_HOST_URL: \$\{\{ secrets\.PRIVATE_SONAR_HOST \}\}/u);
  assert.doesNotMatch(rendered, /vars\.PRIVATE_SONAR_HOST|SOPS_AGE_KEY/u);
});

test('online verification rejects an app runtime key in the CI variable store as well as its secret store', () => {
  const declaration = readCiDeclaration({ ci: { secrets: [], vars: [{ name: 'DB_PASSWORD', scope: 'repository', value: 'synthetic' }] } });
  assert.ok(isValidCiDeclaration(declaration));
  const out: string[] = [];
  const gh = { repository: () => 'owner/project-a', run: () => '', json: (args: string[]) => args[0] === 'variable' ? [{ name: 'DB_PASSWORD', value: 'synthetic' }] : [] };
  assert.equal(verifyCi({ declaration, sealed: [{ key: 'DB_PASSWORD' }], runtime: [{ key: 'DB_PASSWORD' }], gh, options: {}, stdout: (value) => out.push(value) }), 1);
  assert.match(out.join(''), /APP_SECRET_IN_CI/u);
});

test('native identity Git children receive no age identity or declared service credential; sync and release choose the origin repository', async (t) => {
  const { root, doc, write } = fixture(t), bin = path.join(root, 'bin'), report = path.join(root, 'identity-env.jsonl');
  fs.mkdirSync(bin); fs.mkdirSync(path.join(root, '.git'));
  const executable = path.join(bin, process.platform === 'win32' ? 'git.exe' : 'git');
  fs.copyFileSync(process.execPath, executable); if (process.platform !== 'win32') fs.chmodSync(executable, 0o755);
  const observed = ['SOPS_AGE_KEY', 'SOPS_AGE_KEY_FILE', 'SONAR_TOKEN', 'SONAR_PASSWORD', 'PROJECT_ANALYSIS_TOKEN'];
  const log = `require('node:fs').appendFileSync(${JSON.stringify(report)},JSON.stringify({present:${JSON.stringify(observed)}.filter(name=>Object.hasOwn(process.env,name)),public:process.env.KEEP_PUBLIC})+'\\n');`;
  fs.writeFileSync(path.join(root, 'rev-parse'), `${log}process.stdout.write(${JSON.stringify(root + '\n' + path.join(root, '.git'))});`);
  fs.writeFileSync(path.join(root, 'remote'), `${log}process.stdout.write('https://github.com/owner/project-a.git');`);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: '@owner/different-package' }));
  write();
  const pathKey = Object.keys(process.env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH';
  const env = identityQueryEnvironment({ ...process.env, [pathKey]: bin + path.delimiter + process.env[pathKey], KEEP_PUBLIC: 'retained',
    ...Object.fromEntries(observed.map((name) => [name, 'synthetic-private'])) }, serviceCredentialNames(doc));
  assert.equal(repositoryName(root, { env }), 'project-a');
  const rows = fs.readFileSync(report, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { present: string[]; public: string });
  assert.ok(rows.length >= 2);
  for (const row of rows) { assert.deepEqual(row.present, []); assert.equal(row.public, 'retained'); }
  // The shared selector, using real Git for this newly initialized repository, follows its origin rather than package.json.
  fs.rmSync(path.join(root, '.git'), { recursive: true });
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: root }).status, 0);
  assert.equal(spawnSync('git', ['remote', 'add', 'origin', 'https://github.com/owner/project-a.git'], { cwd: root }).status, 0);
  assert.equal(await readDeclaredSonarKey(root, { fail: (message) => assert.fail(message) }), 'org:project-a');
});

test('exact tooling custody is declared without a runtime grant; same-named app custody remains refused', (t) => {
  const { root, doc, write } = fixture(t);
  const before = fs.readFileSync(path.join(root, '.starcistacks/application-stacks.yaml'), 'utf8');
  assert.deepEqual(declareKeys(root, 'dev', 'sonar', ['PROJECT_ANALYSIS_TOKEN']), { declared: [], byHand: [] });
  assert.equal(fs.readFileSync(path.join(root, '.starcistacks/application-stacks.yaml'), 'utf8'), before);
  assert.equal(auditSecrets(root).some((finding) => finding.code === 'UNDECLARED_KEY'), false);
  const binding = serviceBindings(doc, 'project-a').bindings[0]!;
  assert.equal(serviceCredentialValue(root, binding, { decrypt: () => ({ PROJECT_ANALYSIS_TOKEN: VALUE }) }) === VALUE, true);
  fs.mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github/workflows/ci.yml'), 'env:\n  SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}\n');
  const run = () => ciCustodyFindings({ repoRoot: root, repo: { kind: 'app', edition: 'lite' }, isRoot: true });
  assert.deepEqual(run(), []);
  fs.writeFileSync(path.join(root, '.starcistacks/dev/secrets/runtime.enc.yaml'), envelope(['SONAR_TOKEN']));
  assert.ok(run().some((finding) => finding.code === 'CI_SECRET_SEALED'));
  doc.services.sonar.credentials[0]!.project = 'org:project-b'; write();
  assert.equal(serviceBindings(doc, 'project-a').bindings.length, 0);
});

test('an unsealed service credential is the open owner step its service declares, and a finding once the declaration says none', (t) => {
  const { root, doc, write } = fixture(t);
  fs.rmSync(path.join(root, MEMBER));
  fs.mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github/workflows/ci.yml'), 'env:\n  SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}\n');
  const run = () => ciCustodyFindings({ repoRoot: root, repo: { kind: 'app', edition: 'lite' }, isRoot: true }).map((finding) => finding.code);
  Object.assign(doc.services.sonar, { ownerAction: { needed: 'seal the analysis token', reason: 'a fresh app fabricates no credential' } }); write();
  assert.deepEqual(run(), []);
  Object.assign(doc.services.sonar, { ownerAction: 'none' }); write();
  assert.deepEqual(run(), ['CI_SECRET_SEALED']);
});
