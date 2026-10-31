// The clean-install proof of @starci/hfs (scripts/gates/package-clean-test.mjs runs `npm test` in a copy of this folder with
// nothing installed): the CLI's whole static module graph loads from the published folders alone - hfs declares no
// dependency, so any bare import here would fail - and a call with no verb prints the usage and refuses with exit 2.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main, VERBS } from './main.mjs';

test('the app implementation loads with no installed dependency and refuses a missing verb with its usage', async () => {
  let err = '';
  const code = await main([], { stdout: () => {}, stderr: (s) => { err += s; } });
  assert.equal(code, 2);
  assert.match(err, /^starci app check /m);
  assert.match(err, /^starci app scaffold <name>/m);
  assert.match(err, /^starci app secret list/m);
  assert.match(err, /^starci app coverage merge --out <lcov>/m);
  assert.deepEqual(VERBS, ['scaffold', 'add', 'lint', 'sync', 'check', 'upgrade', 'stack', 'world', 'release', 'slot', 'emit', 'secret', 'ci', 'db', 'coverage', 'codemod']);
});

test('global options use cwd, upgrade refuses a lite app because editions are fixed at scaffold, and a full app it cannot give a world', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-app-main-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const wanted = path.join(base, 'app');
  fs.mkdirSync(wanted);
  let call: { argv: string[]; cwd: string } | undefined;
  const stackMain = async (argv: string[], io: { cwd: string }) => { call = { argv, cwd: io.cwd }; return 0; };
  assert.equal(await main(['world', 'status', '--cwd', 'app', '--edition', 'full'], { cwd: base, stackMain }), 0);
  assert.deepEqual(call, { argv: ['status'], cwd: wanted });
  let err = '';
  const lite = path.join(base, 'lite');
  fs.mkdirSync(lite);
  const liteDeclaration = { hfs: 3, kind: 'app', project: 'lite', edition: 'lite', sides: { be: { apps: [{ name: 'core', kind: 'api' }] }, fe: { apps: [{ name: 'landing', kind: 'next' }], reads: ['be/contracts/'] } } };
  fs.writeFileSync(path.join(lite, 'hfs.json'), JSON.stringify(liteDeclaration));
  for (const argv of [['upgrade', '--cwd', lite], ['upgrade', '--execute', '--cwd', lite]]) {
    err = '';
    assert.equal(await main(argv, { stderr: (text) => { err += text; } }), 2, argv.join(' '));
    assert.match(err, /^HFS_UPGRADE_EDITION_FIXED: editions are fixed at scaffold: a lite app stays lite/, argv.join(' '));
  }
  // upgrade reads no --edition: the shared parser leaves it to upgrade, which refuses it by its own code (an edition is chosen at scaffold).
  for (const argv of [['upgrade', '--edition', 'lite', '--cwd', lite], ['upgrade', '--edition', 'full', '--cwd', lite], ['upgrade', '--edition=full', '--execute', '--cwd', lite]]) {
    err = '';
    assert.equal(await main(argv, { stderr: (text) => { err += text; } }), 2, argv.join(' '));
    assert.equal(err, 'HFS_UPGRADE_USAGE: upgrade takes no --edition: editions are fixed at scaffold\n', argv.join(' '));
  }
  assert.equal(fs.readFileSync(path.join(lite, 'hfs.json'), 'utf8'), JSON.stringify(liteDeclaration));
  const declaration = { hfs: 3, kind: 'app', project: 'app', sides: { be: { apps: [{ name: 'core', kind: 'api' }] }, fe: { apps: [{ name: 'landing', kind: 'next' }], reads: ['be/contracts/'] } } };
  const declared = JSON.stringify(declaration);
  fs.writeFileSync(path.join(wanted, 'hfs.json'), declared);
  err = '';
  assert.equal(await main(['upgrade', '--cwd', wanted], { stderr: (text) => { err += text; } }), 2);
  assert.match(err, /^HFS_SCAFFOLD_TEST_WORLD: the test world migrates the connections of hfs\.json, and it declares none\n$/);
  assert.equal(fs.readFileSync(path.join(wanted, 'hfs.json'), 'utf8'), declared);
});

test('upgrade adds the test world a full app lacks, never overwrites one, and then reports the app complete', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-app-world-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const declaration = {
    hfs: 3, kind: 'app', project: 'shop',
    sides: {
      be: { apps: [{ name: 'core', kind: 'api' }, { name: 'cli', kind: 'cli' }], kinds: ['api', 'cli'], connections: [{ name: 'primary', envPrefix: 'PRIMARY_DB', owner: 'core', isolation: 'database' }] },
      fe: { apps: [{ name: 'landing', kind: 'next' }], reads: ['be/contracts/'] },
    },
  };
  fs.writeFileSync(path.join(root, 'hfs.json'), JSON.stringify(declaration));
  const tools = ['@nestjs/testing', '@starci/jest-preset', '@starci/test-world', '@types/jest', 'jest', 'ts-jest'];
  const manifest = `${JSON.stringify({ name: 'shop', devDependencies: Object.fromEntries(tools.map((name) => [name, '1.0.0'])) }, null, 2)}\n`;
  fs.writeFileSync(path.join(root, 'package.json'), manifest);
  const world = [
    'be/src/tests/world/test-world.config.ts', 'be/src/tests/world/test-apps.options.ts', 'be/src/tests/world/use-test-world.ts',
    'be/src/tests/world/global-setup.ts', 'be/src/tests/world/global-teardown.ts', 'be/src/tests/fixtures/persistence/migrations.sql.ts',
    'be/src/tests/integration/readiness/readiness.integration-spec.ts', 'be/src/tests/e2e/system-health/core-serves-once-migrated.e2e-spec.ts',
  ];
  const run = async (argv: string[]) => {
    let stdout = '';
    let stderr = '';
    const code = await main([...argv, '--cwd', root], { stdout: (text) => { stdout += text; }, stderr: (text) => { stderr += text; } });
    return { code, stdout, stderr };
  };

  const planned = await run(['upgrade']);
  assert.equal(planned.code, 0, planned.stderr);
  assert.deepEqual(planned.stdout.trim().split('\n').slice(0, -1).map((line) => line.slice(0, line.indexOf(':'))), world.map((file) => `add ${file}`));
  assert.match(planned.stdout, /starci app upgrade: 8 steps planned; no file written\n$/);
  assert.equal(fs.existsSync(path.join(root, 'be')), false, 'upgrade is a dry run until --execute');

  const applied = await run(['upgrade', '--execute']);
  assert.equal(applied.code, 0, applied.stderr);
  assert.match(applied.stdout, /starci app upgrade --execute: 8 steps applied\n$/);
  const config = fs.readFileSync(path.join(root, 'be/src/tests/world/test-world.config.ts'), 'utf8');
  assert.ok(config.includes('import { AppModule as CoreApp } from "../../../apps/core/src/app.module"'));
  assert.ok(config.includes('postgresql: { connections: [{ name: "primary" }] },'));
  assert.ok(config.includes('core: { module: CoreApp, options: coreOptionsOf, configure: applyCorrelation },'));
  assert.ok(config.includes('import { applyCorrelation } from "@modules/platform/logging"'));
  const options = fs.readFileSync(path.join(root, 'be/src/tests/world/test-apps.options.ts'), 'utf8');
  assert.ok(options.includes('PRIMARY_DB_URL: w.db.primary.url,'));
  assert.ok(options.includes('readCoreEnv(environmentOf(w, { PORT: String(w.apps.core.port) }))'));
  assert.ok(fs.readFileSync(path.join(root, 'be/src/tests/fixtures/persistence/migrations.sql.ts'), 'utf8').includes('SELECT name FROM primary_migrations ORDER BY id LIMIT 500'));
  assert.equal(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), manifest);

  const again = await run(['upgrade', '--execute']);
  assert.equal(again.code, 0, again.stderr);
  assert.equal(again.stdout, 'starci app upgrade --execute: 0 steps applied (the full app is complete)\n');

  fs.rmSync(path.join(root, 'be/src/tests/world/global-setup.ts'));
  fs.writeFileSync(path.join(root, 'be/src/tests/world/test-world.config.ts'), 'export const owned = true\n');
  const conflict = await run(['upgrade', '--execute']);
  assert.equal(conflict.code, 2);
  assert.match(conflict.stderr, /^HFS_UPGRADE_FILE_CONFLICT: be\/src\/tests\/world\/test-world\.config\.ts already exists/);
  assert.equal(fs.readFileSync(path.join(root, 'be/src/tests/world/test-world.config.ts'), 'utf8'), 'export const owned = true\n');
  assert.equal(fs.existsSync(path.join(root, 'be/src/tests/world/global-setup.ts')), false);
});

test('world refuses with exit 2 and an install hint when the app has no test-world package', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-app-stack-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  let err = '';
  const code = await main(['world', 'status'], { cwd, stdout: () => {}, stderr: (text) => { err += text; } });
  assert.equal(code, 2);
  assert.match(err, /needs @starci\/test-world installed in the app/);
});

/** Runs `starci app <argv>` in a fresh folder; returns { code, out, err }. */
async function app(t: TestContext, argv: string[]) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-app-flags-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  let out = '';
  let err = '';
  const code = await main(argv, { cwd, stdout: (text) => { out += text; }, stderr: (text) => { err += text; } });
  return { code, out, err };
}

test('the shared parser refuses a flag of another verb and a value flag that would swallow the next flag', async (t) => {
  for (const [argv, message] of [
    [['check', '--event', 'x'], 'starci app check takes no --event'],
    [['emit', '--json'], 'starci app emit takes no --json'],
    [['slot', 'be/x.ts', '--full'], 'starci app slot takes no --full'],
    [['scaffold', 'shop', '--inject', 'A=b'], 'starci app scaffold takes no --inject'],
    [['add', 'job', 'x', '--inject', 'A=b'], 'starci app add job takes no --inject; only add service does'],
    [['add', 'image', '--event', 'x'], 'starci app add image takes no --event'],
    [['add', 'spec', 'be/x.service.ts', '--inject', 'A=b'], 'starci app add spec takes no --inject; only add service does'],
    [['add', 'service', 'be/x', 'y', '--form'], 'starci app add service takes no --form'],
    [['check', '--staged', '--json'], 'starci app check --staged is the pre-commit guard alone and takes no --json'],
    [['check', '--staged', '--full', '--hfs'], 'starci app check --staged is the pre-commit guard alone and takes no --full, --hfs'],
    [['check', '--staged', '--edition', 'full'], 'starci app check --staged is the pre-commit guard alone and takes no --edition'],    [['emit', '--edition', 'full'], 'starci app emit takes no --edition'],
    [['check', '--bogus'], 'unknown flag --bogus'],
    [['check', '--fast'], 'unknown flag --fast'],
    [['check', '--coverage-from', '--json'], '--coverage-from needs a value'],
    [['add', 'job', 'x', '--event', '--from', 'y'], '--event needs a value'],
    [['check', '--coverage-from', 'a', '--coverage-from=b'], '--coverage-from may be given only once'],
  ] as Array<[string[], string]>) {
    const run = await app(t, argv);
    assert.equal(run.code, 2, argv.join(' '));
    assert.ok(run.err.startsWith(`starci app: ${message}\n`), `${argv.join(' ')}: ${run.err.split('\n')[0]}`);
  }
});

test('sync takes only --execute: any other argument prints the usage and refuses', async (t) => {
  for (const argv of [['sync', '--bogus'], ['sync', '--execute', '--execute'], ['sync', 'extra']]) {
    const run = await app(t, argv);
    assert.equal(run.code, 2, argv.join(' '));
    assert.equal(run.out, 'usage: starci app sync [--execute] [--cwd <dir>]\n', argv.join(' '));
  }
});

/** The flag lists a verb's parser table may carry. */
interface FlagsSpec { boolean?: readonly string[]; value?: readonly string[]; list?: readonly string[]; retired?: readonly string[] }

test('the usage is generated from the parser tables: every flag every verb parses appears on that verb\'s lines', async (t) => {
  const { out } = await app(t, ['--help']);
  const { FLAGS: STACK_FLAGS, ACTIONS: STACK_ACTIONS } = await import('../stack/cli.mjs');
  const { RELEASE_FLAGS } = await import('../release/index.mjs');
  const { SECRET_FLAGS } = await import('../runtime/scripts/hfs/secret.mjs');
  const { COMMANDS: CI_COMMANDS } = await import('../ci/cli.mjs');
  const { LOCAL_FLAGS } = await import('../ci/local.mjs');
  const { BASELINE_OPTIONS } = await import('../runtime/scripts/hfs/db-baseline-verb.mjs');
  const { RESTAMP_OPTIONS } = await import('../runtime/scripts/hfs/db-restamp-verb.mjs');
  const db = Object.fromEntries(await Promise.all(['migrate', 'post-cutover', 'dump', 'new', 'drift'].map(async (verb: string): Promise<[string, FlagsSpec]> => [verb, (await import(`../db/${verb}.mjs`)).SPEC])));
  const { parseLintArgs } = await import('../lint/run.mjs');
  const { codemodArguments } = await import('../codemod/button-intent.mjs');
  const { spacingRolesArguments } = await import('../codemod/main.mjs');
  const { upgradeArguments } = await import('../upgrade/index.mjs');
  const flagsOfSpec = (spec: FlagsSpec) => [...(spec.boolean ?? []), ...(spec.value ?? []), ...(spec.list ?? [])].filter((flag) => !(spec.retired ?? []).includes(flag));
  // A hand-parsed verb: the flag literals its parser compares with.
  const flagsOfParser = (parser: { toString(): string }) => [...new Set([...parser.toString().matchAll(/['"`](--[a-z][a-z0-9-]*)['"`]/g)].map((match) => match[1] as string))];
  const lines = (prefix: string) => out.split('\n').filter((text) => text.startsWith(`starci app ${prefix} `) || text === `starci app ${prefix}`);
  const expect = (prefix: string, flags: readonly string[]) => {
    const text = lines(prefix).join('\n');
    assert.ok(text, `no usage line for starci app ${prefix}`);
    for (const flag of flags.filter((name: string) => name !== '--cwd')) assert.ok(text.includes(`[${flag}]`) || text.includes(`[${flag} `), `starci app ${prefix} usage lacks ${flag}`);
  };
  assert.deepEqual(new Set(Object.keys(STACK_FLAGS)), new Set(STACK_ACTIONS), 'every stack action declares its flags');
  for (const action of STACK_ACTIONS) expect(`stack ${action}`, [...STACK_FLAGS[action], '--json']);
  for (const [action, spec] of Object.entries(RELEASE_FLAGS)) expect(`release ${action}`, flagsOfSpec(spec));
  for (const flag of flagsOfSpec(SECRET_FLAGS).filter((name) => name !== '--cwd')) assert.ok(lines('secret').some((text) => text.includes(`${flag} `) || text.includes(`${flag}]`)), `secret usage lacks ${flag}`);
  for (const [command, options] of Object.entries(CI_COMMANDS)) expect(`ci ${command}`, options.map((name) => `--${name}`));
  expect('ci local', flagsOfSpec(LOCAL_FLAGS));
  for (const [verb, names] of [['baseline', BASELINE_OPTIONS], ['restamp', RESTAMP_OPTIONS]] as Array<[string, readonly string[]]>) expect(`db ${verb}`, names.map((name: string) => `--${name}`));
  for (const [verb, spec] of Object.entries(db)) expect(`db ${verb}`, flagsOfSpec(spec));
  expect('lint', flagsOfParser(parseLintArgs));
  expect('codemod button-intent', flagsOfParser(codemodArguments));
  expect('codemod spacing-roles', flagsOfParser(spacingRolesArguments));
  expect('upgrade', flagsOfParser(upgradeArguments).filter((flag) => !['--repo', '--edition'].includes(flag)));
  for (const verb of ['check', 'scaffold']) expect(verb, ['--edition']);
  // The canonical spellings are on the usage lines.
  for (const line of ['starci app slot <path> [--json]', 'starci app world <up|down|status>', 'starci app add service <dir> <name> [--inject <binding>]...', 'starci app add spec <file>.service.ts', 'starci app add image',
    'starci app check [--staged]', 'starci app sync [--execute]', 'starci app upgrade [--execute]', 'starci app codemod button-intent [--execute] [--json] [--format json|markdown] [--out ', 'starci app codemod spacing-roles [--execute] [--json] [--format json|markdown] [--out ']) assert.ok(out.includes(line), line);
  assert.match(out, /^starci app lint .*\[--json\] \[--out <file>\]$/m);
  assert.match(out, /^starci app scaffold <name> \[--registry-visibility public\|private\] \[--edition full\|lite\]$/m);
  assert.doesNotMatch(out, /app (hygiene|explain|new|sonar)\b|--plan|--write|--check\b|--into\b(?!-)|--report|app stack <up/, 'the usage lists no old spelling');
});

test('the scaffold hint and the managed scripts name commands that exist', async () => {
  const source = fs.readFileSync(new URL('./main.mjs', import.meta.url), 'utf8');
  assert.match(source, /next: npm ci \(the lockfile/);
  assert.doesNotMatch(source, /starci npm/, 'the CLI has no npm group');
  const { ACTIONS: STACK_ACTIONS } = await import('../stack/cli.mjs');
  const scripts = fs.readFileSync(new URL('../templates/app/package-scripts/package.json', import.meta.url), 'utf8');
  const calls = [...scripts.matchAll(/"starci app ([a-z-]+)((?: [a-z-]+)*)"/g)];
  assert.ok(calls.length > 0);
  for (const [, verb = '', rest = ''] of calls) {
    assert.ok(VERBS.includes(verb), `starci app ${verb}`);
    if (verb === 'stack') assert.ok((STACK_ACTIONS as readonly string[]).includes(rest.trim().split(' ')[0] as string), `starci app stack${rest} names no action`);
    if (verb === 'world') assert.ok(['up', 'down', 'status'].includes(rest.trim().split(' ')[0] as string), `starci app world${rest} names no action`);
  }
});
