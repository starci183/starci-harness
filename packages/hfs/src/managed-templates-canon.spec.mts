// managed-templates-canon.spec.mts - every TypeScript file `starci app sync` manages is a fixed point of the canon it ships with.
// `app sync` requires a managed file byte for byte, and `app check --gate lint --fix` rewrites it to the canon's autofix output, so a
// render the autofix would change (a value import and a type import of one module left split, a merge laid out differently from
// Prettier) leaves an app that can never be green: sync reports HFS_SYNC_DRIFT on the file lint just fixed. For a lite and a full app
// declaration the spec renders the whole managed set (`renderRepo`, the very targets sync writes), lints every back-end and front-end
// TypeScript target with the real built canon with `fix: true` semantics, and asserts the autofix changes nothing and nothing remains
// to report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ESLint } from 'eslint';
import type { Linter } from 'eslint';
import type { LockResult } from '../scaffold/app.mjs';
import { bundledPresets, renderRepo } from '../sync/index.mjs';
import { scaffoldApp } from '../scaffold/app.mjs';
import { addKind } from '../scaffold/add.mjs';
import { init } from '../runtime/scripts/api/git/init.mjs';
import { gitAdd, installTypeScript } from './helpers/hfs-cli-fixture.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';
import { loadHfs as loadBeHfs, starciBeConfig } from '../../eslint-canon-be/dist/index.js';
import { loadHfs as loadFeHfs, starciFeConfig } from '../../eslint-canon-fe/dist/index.js';

const HFS = path.resolve(import.meta.dirname, '..');
const SIBLINGS = ['jest-preset', 'auth', 'mail', 'nest-kit'];
// test-world's installs carry @nestjs/cqrs, whose bus types the door rules compare.
const INSTALLS = [HFS, path.resolve(HFS, '..', 'test-world'), ...SIBLINGS.map((name) => path.resolve(HFS, '..', name))].map((dir) => path.join(dir, 'node_modules'));

const lockedOk = (root: string): LockResult => {
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  return { ok: true };
};

/** Type-graph verdicts judge the fixture's partial installs, not the template (an app installs everything and runs them itself). */
const TYPE_GRAPH_RULES = new Set(['@typescript-eslint/no-unsafe-assignment', '@typescript-eslint/no-unsafe-member-access', '@typescript-eslint/no-unsafe-call', '@typescript-eslint/no-unsafe-return', '@typescript-eslint/no-unsafe-argument']);
const shippedCanon = (config: Linter.Config[]): Linter.Config[] => config.map((block) => (block.rules === undefined ? block : {
  ...block, rules: Object.fromEntries(Object.entries(block.rules).filter(([id]) => !TYPE_GRAPH_RULES.has(id))),
}));

const installBuilt = (root: string, name: string) => {
  for (const part of ['package.json', 'dist']) fs.cpSync(path.resolve(HFS, '..', name, part), path.join(root, 'node_modules', '@starci', name, part), { recursive: true });
};

const lintProject = (side: string) => {
  const paths: Record<string, string[]> | undefined = JSON.parse(fs.readFileSync(path.join(side, 'tsconfig.json'), 'utf8')).compilerOptions?.paths;
  const file = path.join(side, 'tsconfig.canon.json');
  fs.writeFileSync(file, JSON.stringify({ extends: './tsconfig.json', compilerOptions: {
    typeRoots: INSTALLS.map((dir) => path.join(dir, '@types')), types: ['node', 'jest'],
    ...(paths === undefined ? {} : { paths: { ...paths, '@starci/nest-kit': [path.resolve(HFS, '..', 'nest-kit', 'dist', 'index.d.ts')], '*': INSTALLS.map((dir) => path.join(dir, '*')) } }),
  } }));
  return file;
};

/** A full app's starter connection names no provider; a table needs one. */
const addTable = (root: string) => {
  const file = path.join(root, 'hfs.json');
  const hfs = JSON.parse(fs.readFileSync(file, 'utf8'));
  hfs.sides.be.connections = hfs.sides.be.connections.map((connection: Record<string, unknown>) => ({ provider: 'postgres', ...connection }));
  fs.writeFileSync(file, `${JSON.stringify(hfs, null, 2)}\n`);
  addKind({ repoRoot: root, noun: 'table', name: 'widgets' });
};

for (const edition of ['full', 'lite']) {
  test(`every TypeScript file app sync manages in a ${edition} app is a fixed point of the canon`, { timeout: 600_000 }, async (t) => {
    const { root } = scaffoldApp({ name: 'demo', into: mkdtemp(t, 'starci-managed-canon-'), harness: { version: '1.1.0-alpha.3' }, edition,
      presets: bundledPresets(), lock: lockedOk, initGit: init });
    addTable(root);
    gitAdd(installTypeScript(root));
    for (const name of SIBLINGS) installBuilt(root, name);
    const { targets } = await renderRepo(root, { presets: bundledPresets() });
    const managed = targets.filter((target) => /\.(?:ts|tsx|mts)$/u.test(target.path) && target.mode !== 'block');
    // The render is what sync writes: put it on disk exactly as sync would, then judge the disk.
    for (const target of managed) {
      fs.mkdirSync(path.dirname(path.join(root, target.path)), { recursive: true });
      fs.writeFileSync(path.join(root, target.path), target.content);
    }
    const sides = [
      { name: 'be', files: managed.filter((target) => target.path.startsWith('be/')), canon: async (dir: string) => shippedCanon(await starciBeConfig({ hfs: loadBeHfs(pathToFileURL(path.join(dir, 'eslint.config.mjs')).href) }) as Linter.Config[]) },
      { name: 'fe', files: managed.filter((target) => target.path.startsWith('fe/')), canon: async (dir: string) => shippedCanon(starciFeConfig({ hfs: loadFeHfs(pathToFileURL(path.join(dir, 'eslint.config.mjs')).href) }) as Linter.Config[]) },
    ];
    const judged: string[] = [];
    const problems: string[] = [];
    for (const side of sides) {
      if (side.files.length === 0) continue;
      const dir = path.join(root, side.name);
      const eslint = new ESLint({ cwd: dir, overrideConfigFile: true, errorOnUnmatchedPattern: false, fix: true, overrideConfig: [
        ...await side.canon(dir), { files: ['**/*.{ts,tsx,mts}'], languageOptions: { parserOptions: { projectService: false, project: lintProject(dir), tsconfigRootDir: dir } } },
      ] });
      const results = await eslint.lintFiles(side.files.map((target) => target.path.slice(side.name.length + 1)));
      for (const result of results) {
        const rel = `${side.name}/${path.relative(dir, result.filePath).split(path.sep).join('/')}`;
        judged.push(rel);
        const target = side.files.find((candidate) => candidate.path === rel);
        if (result.output !== undefined && target !== undefined) problems.push(`${rel}: the canon autofix rewrites the render\n--- render\n${target.content}\n--- autofix\n${result.output}`);
        for (const message of result.messages) problems.push(`${rel}:${message.line} ${message.ruleId ?? 'parse'} ${message.message}`);
      }
    }
    assert.ok(managed.length > 0 || edition === 'full', 'a lite app manages TypeScript files');
    assert.deepEqual(managed.map((target) => target.path).filter((file) => !judged.includes(file)), [], 'every managed TypeScript file is judged');
    assert.deepEqual(problems, []);
  });
}
