// proves: BE_CLI_REQUIRED@lite
// proves: BE_CLI_REQUIRED@full
// proves: BE_CLI_CLIENT@lite
// proves: BE_CLI_CLIENT@full
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cliFindings } from '../runtime/scripts/hfs/rules/cli.mjs';
import { createSlotResolver, loadSlotManifest, resolveRepoDeclaration } from '../runtime/scripts/hfs/slots.mjs';
import type { AppRef, ConnectionView } from '../runtime/scripts/hfs/slots.mjs';

const manifest = loadSlotManifest();
const API = { name: 'api', kind: 'api' };
const CLI = { name: 'cli', kind: 'cli' };
const COMMAND = 'be/src/features/cli/migrate/subs/run.cli.ts';
const IMAGE = 'be/apps/cli/Dockerfile';
const PRIMARY = [{ name: 'primary', envPrefix: 'PRIMARY_DB', owner: 'api', isolation: 'database' }];

const CLIENT = { name: 'relay-cli', kind: 'client-cli', package: '@acme/relay', bin: 'relay' };
const CLIENT_ROOT = ['be/src/features/client-cli/relay-cli/index.ts', 'be/src/features/client-cli/relay-cli/relay-cli.module.ts'];
const CLIENT_MANIFEST = 'be/apps/relay-cli/package.json';
const CLIENT_BUILD = 'be/apps/relay-cli/tsconfig.build.json';
const CLIENT_FILES = [...CLIENT_ROOT, CLIENT_MANIFEST, CLIENT_BUILD];
const GOOD_MANIFEST = { name: '@acme/relay', version: '0.1.0', bin: { relay: 'dist/apps/relay-cli/src/main.js' }, files: ['dist'], dependencies: { 'nest-commander': '3.21.0' } };
const GOOD_BUILD = { extends: '../../tsconfig.build.json', compilerOptions: { outDir: './dist', rootDir: '../..' }, files: ['src/main.ts'], include: [] };

/** A scratch app root holding the root package.json and the two files of the client cli's package. */
function clientRoot(t: { after: (fn: () => void) => void }, manifestJson: unknown = GOOD_MANIFEST, buildJson: unknown = GOOD_BUILD): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-client-cli-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, 'be/apps/relay-cli'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'cli-proof', private: true, dependencies: { 'nest-commander': '3.21.0', typeorm: '0.3.31' } }));
    fs.writeFileSync(path.join(root, CLIENT_MANIFEST), JSON.stringify(manifestJson));
    fs.writeFileSync(path.join(root, CLIENT_BUILD), JSON.stringify(buildJson));
    return root;
}

function input(edition: string, apps: AppRef[], files: string[], connections: ConnectionView[] = [], kinds: string[] = []) {
    const repo = resolveRepoDeclaration(manifest, {
        hfs: 3,
        kind: 'app',
        project: 'cli-proof',
        edition,
        sides: {
            be: { apps, connections, ...(kinds.length ? { kinds } : {}) },
            fe: { apps: [{ name: 'web', kind: 'next' }] },
        },
    });
    assert.equal(repo.edition, edition);
    return { repo, files, resolver: createSlotResolver(manifest, repo) };
}

for (const edition of ['lite', 'full']) {
    test(`${edition} valid CLI app and image pass for tracked commands`, () => {
        assert.deepEqual(cliFindings(input(edition, [API, CLI], [COMMAND, IMAGE])), []);
        assert.deepEqual(cliFindings(input(edition, [API], [])), []);
    });

    test(`${edition} missing CLI app for tracked commands is invalid`, () => {
        assert.deepEqual(cliFindings(input(edition, [API], [COMMAND])).map((finding) => finding.code), ['BE_CLI_REQUIRED']);
    });

    test(`${edition} invalid CLI name and missing CLI image are rejected`, () => {
        const renamed = cliFindings(input(edition, [API, { name: 'ops', kind: 'cli' }], [COMMAND]));
        assert.deepEqual(renamed.map((finding) => finding.code), ['BE_CLI_REQUIRED']);
        assert.equal(renamed[0]!.app, 'ops');
        const imageless = cliFindings(input(edition, [API, CLI], [COMMAND]));
        assert.deepEqual(imageless.map((finding) => finding.code), ['BE_CLI_REQUIRED']);
        assert.equal(imageless[0]!.path, IMAGE);
    });

    test(`${edition} connection-only requirements follow the actual edition slot`, () => {
        const findings = cliFindings(input(edition, [API], [], PRIMARY));
        const expected = edition === 'full' ? ['BE_CLI_REQUIRED'] : [];
        assert.deepEqual(findings.map((finding) => finding.code), expected);
    });
    test(`${edition} a client cli beside the ops cli passes with its package, its build config and its own feature root`, (t) => {
        const repoRoot = clientRoot(t);
        assert.deepEqual(cliFindings({ ...input(edition, [API, CLI, CLIENT], [COMMAND, IMAGE, ...CLIENT_FILES], [], ['api', 'cli', 'client-cli']), repoRoot }), []);
        const resolver = input(edition, [API, CLI, CLIENT], []).resolver.sides!.be;
        assert.equal(resolver.classifyPath('apps/relay-cli/src/main.ts').slot, 'be.app.client-cli');
        assert.equal(resolver.classifyPath('apps/relay-cli/package.json').slot, 'be.app.client-cli.package');
        assert.equal(resolver.classifyPath('src/features/client-cli/relay-cli/run/subs/task.cli.ts').slot, 'be.client-cli');
        assert.notEqual(resolver.classifyPath('apps/relay-cli/Dockerfile').status, 'owned', 'a client cli has no image');
        assert.notEqual(resolver.classifyPath('apps/cli/package.json').status, 'owned', 'only a client cli has a manifest of its own');
        assert.equal(resolver.classifyPath('apps/cli/Dockerfile').slot, 'repo.app-image');
    });

    test(`${edition} a second app of kind cli stays refused, and a client cli never stands in for the ops cli`, () => {
        const second = cliFindings(input(edition, [API, CLI, { name: 'relay-cli', kind: 'cli' }], [COMMAND, IMAGE]));
        assert.deepEqual(second.map((finding) => finding.code), ['BE_CLI_REQUIRED']);
        assert.match(second[0]!.message, /client-cli/);
        const alone = cliFindings(input(edition, [API, CLIENT], [COMMAND, ...CLIENT_FILES]));
        assert.ok(alone.some((finding) => finding.code === 'BE_CLI_REQUIRED' && finding.path === 'hfs.json'), 'an ops command still needs the ops cli');
    });

    test(`${edition} a client cli without package or bin, without its root or its package files is invalid`, () => {
        const bare = cliFindings(input(edition, [API, CLI, { name: 'relay-cli', kind: 'client-cli' }], [COMMAND, IMAGE, ...CLIENT_FILES]));
        assert.deepEqual(bare.map((finding) => [finding.code, finding.field]), [['BE_CLI_CLIENT', 'package'], ['BE_CLI_CLIENT', 'bin']]);
        const onOps = cliFindings(input(edition, [API, { ...CLI, bin: 'ops' }], [COMMAND, IMAGE]));
        assert.deepEqual(onOps.map((finding) => [finding.code, finding.app]), [['BE_CLI_CLIENT', 'cli']]);
        const twin = cliFindings(input(edition, [API, CLI, CLIENT, { ...CLIENT, name: 'other-cli' }], [COMMAND, IMAGE, ...CLIENT_FILES, ...CLIENT_FILES.map((file) => file.replaceAll('relay-cli', 'other-cli'))]));
        assert.deepEqual(twin.map((finding) => finding.field), ['package', 'bin']);
        const rootless = cliFindings(input(edition, [API, CLI, CLIENT], [COMMAND, IMAGE, CLIENT_MANIFEST, CLIENT_BUILD]));
        assert.deepEqual(rootless.map((finding) => finding.path), ['be/src/features/client-cli/relay-cli/']);
        const stray = cliFindings(input(edition, [API, CLI, CLIENT], [COMMAND, IMAGE, ...CLIENT_FILES, 'be/src/features/client-cli/ghost/index.ts']));
        assert.deepEqual(stray.map((finding) => finding.path), ['be/src/features/client-cli/ghost/']);
        const unpackaged = cliFindings(input(edition, [API, CLI, CLIENT], [COMMAND, IMAGE, ...CLIENT_ROOT]));
        assert.deepEqual(unpackaged.map((finding) => finding.path), [CLIENT_MANIFEST, CLIENT_BUILD]);
        assert.ok(unpackaged.every((finding) => finding.code === 'BE_CLI_CLIENT'));
    });

    test(`${edition} a client cli package that differs from its declaration or the root pins is invalid`, (t) => {
        const files = [COMMAND, IMAGE, ...CLIENT_FILES];
        const judge = (manifestJson: unknown, buildJson: unknown = GOOD_BUILD) => cliFindings({ ...input(edition, [API, CLI, CLIENT], files), repoRoot: clientRoot(t, manifestJson, buildJson) });
        const wrong = judge({ name: '@acme/other', private: true, bin: { relay: 'be/dist/apps/relay-cli/src/main.js' }, files: ['src'], dependencies: { 'nest-commander': '3.20.0', lodash: '4.17.21' } });
        assert.ok(wrong.every((finding) => finding.code === 'BE_CLI_CLIENT' && finding.path === CLIENT_MANIFEST));
        const said = wrong.map((finding) => finding.message).join('\n');
        for (const part of [/its name is "@acme\/other"/, /its bin is/, /it is private/, /no semver version/, /files do not hold dist/, /nest-commander@3\.20\.0; the app root pins 3\.21\.0/, /lodash, which the app root's package\.json does not pin/]) assert.match(said, part);
        const whole = judge(GOOD_MANIFEST, { compilerOptions: { outDir: '../../dist', rootDir: '.' }, include: ['src/**/*.ts'] });
        assert.deepEqual(whole.map((finding) => finding.path), [CLIENT_BUILD, CLIENT_BUILD, CLIENT_BUILD, CLIENT_BUILD]);
    });
}
