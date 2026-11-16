/** A seed-standard reaches an app by one path, the bring-up seed step over the pinned commit (PROJECT-STACKS-13, R435): every other way in is refused. */
// proves: HFS_DATA_SECOND_LOADER@lite
// proves: HFS_DATA_SECOND_LOADER@full
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { dataSecondLoaderFindings, isLoaderCandidate, secondLoaderFindings } from '../runtime/scripts/hfs/rules/data-loaders.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

const kinds = (file: string, text: string): string[] => secondLoaderFindings(file, text).map((finding) => `${String(finding.kind)}:${String(finding.line)}`);

test('R435 kind git: a script or source line that clones, pulls or fetches a -seed-standard repository', () => {
  assert.deepEqual(kinds('scripts/content.sh', '#!/bin/sh\nset -eu\ngit clone --depth 1 https://github.com/example/shop-seed-standard "$TMP/content"\n'), ['git:3']);
  assert.deepEqual(kinds('be/src/content/refresh.ts', "import { spawnSync } from 'node:child_process';\nspawnSync('git', ['pull', 'origin', 'main'], { cwd: '../shop-seed-standard' });\n"), ['git:2']);
  assert.deepEqual(kinds('.github/workflows/content.yml', 'jobs:\n  sync:\n    steps:\n      - run: git -C content fetch https://github.com/example/shop-seed-standard.git main\n'), ['git:4']);
  assert.deepEqual(kinds('scripts/content.sh', 'git clone https://github.com/example/shop-docs\n'), [], 'a repository that is no standard');
});

test('R435 kind command: a content-sync command, as a package.json script or a declared command name', () => {
  assert.deepEqual(kinds('package.json', JSON.stringify({ name: 'shop', scripts: { build: 'tsc', 'content:sync': 'node scripts/sync.mjs' } }, null, 2)), ['command:5']);
  assert.deepEqual(kinds('be/package.json', JSON.stringify({ scripts: { refresh: 'node pull.mjs https://github.com/example/shop-seed-standard' } }, null, 2)), ['command:3']);
  assert.deepEqual(kinds('be/src/cli/content.command.ts', "@Command({ name: 'content-sync', description: 'pull the lessons' })\nexport class ContentSync {}\n"), ['command:1']);
  assert.deepEqual(kinds('package.json', JSON.stringify({ scripts: { 'seed:run': 'starci app stack up --env dev --execute' } })), [], 'the app\'s own seed command is no content sync');
  assert.deepEqual(kinds('package.json', '{ not json'), []);
  assert.deepEqual(kinds('package.json', '{"name":"x"}'), []);
});

test('R435 kind env: an environment variable naming a -seed-standard repository, or a SEED_STANDARD name, outside the seed step', () => {
  assert.deepEqual(kinds('.env.example', 'PORT=3000\nCONTENT_REPO=https://github.com/example/shop-seed-standard\n'), ['env:2']);
  assert.deepEqual(kinds('be/src/config.ts', 'export const contentRoot = process.env.SHOP_SEED_STANDARD_DIR ?? "";\n'), ['env:1']);
  assert.deepEqual(kinds('.starcistacks/dev/compose.yaml', 'services:\n  api:\n    environment:\n      - CONTENT_REPO=https://github.com/example/shop-seed-standard\n'), ['env:4']);
  assert.deepEqual(kinds('Dockerfile', 'FROM node:22\nENV CONTENT_REPO https://github.com/example/shop-seed-standard\n'), ['env:2']);
  assert.deepEqual(kinds('.starcistacks/application-stacks.yaml', 'environments:\n  dev:\n    local:\n      processes:\n        - name: api\n          env:\n            CONTENT_REPO: https://github.com/example/shop-seed-standard\n'), ['env:7'], 'a process env of the stack is an env too');
});

test('R435 allowed: the data.sets declaration, the project extension, docs, lock files and anything that names no standard', () => {
  const declaration = 'data:\n  sets:\n    - id: shop-standard\n      purpose: seed-standard\n      to: [{driver: git, repository: https://github.com/example/shop-seed-standard}]\n      commit: 0123456789abcdef0123456789abcdef01234567\n';
  assert.deepEqual(kinds('.starcistacks/application-stacks.yaml', declaration), [], 'the seed step reads the standard through the declaration');
  assert.deepEqual(kinds('.starcistacks/application-stacks.yaml', 'scripts:\n  - git clone https://github.com/example/shop-seed-standard\n'), [], 'the declaration is the seed step\'s input, judged by R427');
  for (const file of ['ext/checks/core-complete.mjs', 'ext/manifest.json', '.starciwork/concepts/data.md', 'README.md', 'package-lock.json', 'be/node_modules/x/index.js', '.starcistacks/cache/hfs.json'])
    assert.equal(isLoaderCandidate(file), false, file);
  assert.deepEqual(secondLoaderFindings('ext/checks/core-complete.mjs', "pinRepository({ repository: 'https://github.com/example/core-seed-standard' })"), []);
  assert.deepEqual(secondLoaderFindings('be/src/a.ts', null), []);
  assert.deepEqual(kinds('be/src/a.ts', "const SEEDS = ['plans'];\nexport const repository = 'shop-seed-standard';\n"), [], 'a name in a constant is not a way in by itself');
});

test('R435 at the app root: every tracked text file is read, one finding per file and kind', (t) => {
  const root = mkdtemp(t, 'hfs-second-loader-');
  const files: Record<string, string> = {
    'hfs.json': '{"kind":"app"}\n',
    'package.json': JSON.stringify({ scripts: { 'content:pull': 'node scripts/pull.mjs' } }, null, 2),
    'scripts/pull.mjs': "execFileSync('git', ['clone', 'https://github.com/example/shop-seed-standard', dir]);\nexecFileSync('git', ['pull'], { cwd: 'shop-seed-standard' });\n",
    'be/src/main.ts': 'export {};\n',
  };
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  const all = Object.keys(files);
  const findings = dataSecondLoaderFindings({ repoRoot: root, repo: { kind: 'app' }, isRoot: true, all });
  assert.deepEqual(findings.map((finding) => `${finding.code} ${finding.path} ${String(finding.kind)}`), ['HFS_DATA_SECOND_LOADER package.json command', 'HFS_DATA_SECOND_LOADER scripts/pull.mjs git']);
  assert.match(findings[0]?.message ?? '', /only through the bring-up seed step, at the commit data\.sets pins/u);
  assert.deepEqual(dataSecondLoaderFindings({ repoRoot: root, repo: { kind: 'app' }, isRoot: false, all }), [], 'a side scope is judged by the root');
  assert.deepEqual(dataSecondLoaderFindings({ repoRoot: root, repo: { kind: 'package' }, isRoot: true, all }), [], 'only an app loads a standard');
  assert.deepEqual(dataSecondLoaderFindings({ repoRoot: root, repo: { kind: 'app' }, isRoot: true }), [], 'no tracked file, nothing read');
});

test('R435 is report-only until the bring-up loader of data.sets ships: every finding is a warning', () => {
  const findings = secondLoaderFindings('scripts/content.sh', 'git clone https://github.com/example/shop-seed-standard content\n');
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.level, 'warning');
});
