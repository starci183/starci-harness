// scaffold-type-check.spec.mts - a freshly scaffolded app of each edition type-checks and builds on every side. The templates are
// written once and inherited by every new app, so a template that breaks types (a Grammar prop the contract lacks, a vendor type it
// cannot satisfy, an unused import) fails here, not in a product. Each edition is scaffolded into a temp folder, its `@starci`
// dependencies that the app compiles against are linked to the sibling packages of this repository (so the Grammar API the templates
// use is the one in the tree, not the last published one), and ONE `npm install` serves every assertion: `tsc` of the back end (app
// and tests), the build of the workspace packages, `tsc` and `next build` of each front-end app, and the back end build.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { LockResult } from '../scaffold/app.mjs';
import { bundledPresets } from '../sync/index.mjs';
import { scaffoldApp } from '../scaffold/app.mjs';
import { init } from '../runtime/scripts/api/git/init.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

/** The sibling packages an app compiles against, each with the built output it needs (a package with nothing to build lists its manifest). */
const LINKED: Readonly<Record<string, string>> = {
  tsconfig: '../../tsconfig/package.json',
  grammar: '../../grammar/dist',
  heroicons: '../../heroicons/dist',
  'next-data': '../../next-data/dist',
  'event-stream': '../../event-stream/dist',
  'jest-preset': '../../jest-preset/dist',
  'test-world': '../../test-world/dist',
  auth: '../../auth/dist',
  'object-storage': '../../object-storage/dist',
};
const PACKAGES = path.resolve(import.meta.dirname, '..', '..');

/** The lockfile npm resolves is not under test; the install below writes the real one. */
const lockedOk = (root: string): LockResult => {
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  return { ok: true };
};

/** The npm CLI script of the node that runs this spec, so no shell is involved. */
function npmCli(): string {
  const fromNpm = process.env['npm_execpath'];
  if (fromNpm !== undefined && /npm-cli\.[cm]?js$/.test(fromNpm)) return fromNpm;
  const bin = path.dirname(process.execPath);
  const found = [path.join(bin, 'node_modules', 'npm', 'bin', 'npm-cli.js'), path.join(bin, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')].find((file) => fs.existsSync(file));
  assert.ok(found !== undefined, 'npm-cli.js is next to the node that runs the spec');
  return found;
}

/** Runs a node script in a folder and fails with the tail of its output when it exits non-zero. */
function runNode(cwd: string, script: string, args: readonly string[]): void {
  const done = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', CI: '1' } });
  const output = `${done.stdout}${done.stderr}`;
  assert.equal(done.status, 0, `${path.basename(script)} ${args.join(' ')} in ${path.relative(path.dirname(cwd), cwd)}:\n${output.slice(-6000)}`);
}

/** Every package.json of the app outside node_modules. */
const manifests = (folder: string): string[] =>
  fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === '.git' ? [] : manifests(file);
    return entry.name === 'package.json' ? [file] : [];
  });

/** The dependencies only a lint, a format, a unit-test run, a code generation or a dev loop uses: a type-check and a build need none of them. */
const TOOLING: ReadonlySet<string> = new Set(['@graphql-codegen/cli', '@graphql-codegen/client-preset', 'eslint', 'eslint-plugin-react-hooks', 'husky', 'jest', 'prettier',
  'starci-harness', 'stylelint', 'ts-jest', 'ts-node-dev', 'tsconfig-paths', 'turbo']);

/** The sections of a manifest that name dependencies. */
interface Manifest { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }

/**
 * Points the `@starci` packages the app compiles against at this repository's built siblings (the Grammar API the templates use is the
 * one in the tree) and drops the tooling and the lint canons, so one small install serves every check.
 */
function linkSiblings(root: string): void {
  for (const file of manifests(root)) {
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as Manifest;
    for (const section of [manifest.dependencies, manifest.devDependencies]) {
      if (section === undefined) continue;
      for (const name of Object.keys(section)) {
        const sibling = name.startsWith('@starci/') ? name.slice('@starci/'.length) : undefined;
        if (sibling !== undefined && sibling in LINKED) section[name] = `file:${path.join(PACKAGES, sibling).split(path.sep).join('/')}`;
        else if (sibling !== undefined || TOOLING.has(name)) Reflect.deleteProperty(section, name);
      }
    }
    if (manifest.scripts !== undefined) Reflect.deleteProperty(manifest.scripts, 'prepare');
    fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}
`);
  }
  fs.rmSync(path.join(root, 'package-lock.json'), { force: true });
}

const subfolders = (folder: string): string[] => (fs.existsSync(folder) ? fs.readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => path.join(folder, entry.name)).sort() : []);

for (const edition of ['lite', 'full']) {
  test(`a fresh ${edition} app type-checks and builds on every side`, { timeout: 1_200_000 }, async (t: TestContext) => {
    for (const [name, built] of Object.entries(LINKED)) assert.ok(fs.existsSync(path.resolve(import.meta.dirname, built)), `${name} is built (${built}): install and build the sibling package before this spec`);
    const { root } = scaffoldApp({ name: 'demo', into: mkdtemp(t, `starci-scaffold-types-${edition}-`), harness: { version: '1.1.0-alpha.3' }, edition,
      presets: bundledPresets(), lock: lockedOk, initGit: init });
    linkSiblings(root);
    const started = Date.now();
    runNode(root, npmCli(), ['install', '--no-audit', '--no-fund', '--ignore-scripts', '--install-links=true', '--prefer-offline']);
    t.diagnostic(`${edition}: npm install ${((Date.now() - started) / 1000).toFixed(0)}s`);
    /** A step of the edition's checks, its wall time reported beside the result. */
    const step = async (title: string, check: () => void): Promise<void> => {
      await t.test(title, (sub) => {
        const begun = Date.now();
        try { check(); } finally { sub.diagnostic(`${edition}: ${title} ${((Date.now() - begun) / 1000).toFixed(0)}s`); }
      });
    };
    const bin = (...parts: string[]): string => path.join(root, 'node_modules', ...parts);
    const tsc = bin('typescript', 'bin', 'tsc');
    const next = bin('next', 'dist', 'bin', 'next');

    await step('the back end type-checks (sources and specs)', () => {
      runNode(root, tsc, ['-p', 'be/tsconfig.json']);
      if (fs.existsSync(path.join(root, 'be', 'src', 'tests', 'tsconfig.json'))) runNode(root, tsc, ['-p', 'be/src/tests/tsconfig.json']);
    });
    await step('the back end builds', () => {
      runNode(path.join(root, 'be'), tsc, ['-p', 'tsconfig.build.json']);
      runNode(path.join(root, 'be'), bin('tsc-alias', 'dist', 'bin', 'index.js'), ['-p', 'tsconfig.build.json']);
    });
    await step('the front-end workspace packages build', () => {
      for (const folder of subfolders(path.join(root, 'fe', 'packages'))) runNode(folder, tsc, ['-p', 'tsconfig.build.json']);
    });
    for (const folder of subfolders(path.join(root, 'fe', 'apps'))) {
      await step(`the front-end app ${path.basename(folder)} type-checks and builds`, () => {
        runNode(folder, tsc, ['--noEmit']);
        runNode(folder, next, ['build']);
      });
    }
  });
}
