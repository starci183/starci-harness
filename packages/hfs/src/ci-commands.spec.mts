// ci-commands.spec.mts - the managed CI builds the app's root workspace packages (packages/*: the agent SDK, the module packages and the rest) before
// every step that reads their types or compiles code importing them: the fast job's boot proof, every side of the lint matrix, a multi-front-end build,
// the Sonar scan and the nightly cache verify (knowledge/hfs/ci-standard.yaml packages-built-first). An app without root packages renders as before.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { LockResult } from '../scaffold/app.mjs';
import { scaffoldApp } from '../scaffold/app.mjs';
import { addModule } from '../scaffold/add-module.mjs';
import { appSource, bundledPresets, renderTargets } from '../sync/index.mjs';
import { BUILD_MODULES, ciWorkflowCommands, packagesBuildStep } from '../sync/ci-commands.mjs';
import { ciStandardFindings } from '../runtime/scripts/hfs/rules/ci-standard.mjs';
import { parseWorkflow } from '../runtime/scripts/hfs/runtime-rules/workflow-source.mjs';
import { init } from '../runtime/scripts/api/git/init.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

const lockedOk = (root: string): LockResult => {
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  return { ok: true };
};

/** A fresh lite app, with a built-on agent SDK and one module package when `packages` is true. */
function app(t: TestContext, packages: boolean): string {
  const { root } = scaffoldApp({ name: 'demo', into: mkdtemp(t, 'starci-ci-commands-'), harness: { version: '1.1.0-alpha.3' }, edition: 'lite', presets: bundledPresets(), lock: lockedOk, initGit: init });
  if (!packages) return root;
  fs.mkdirSync(path.join(root, 'packages', 'agent-sdk', 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'packages', 'agent-sdk', 'package.json'), '{"name":"@demo/agent-sdk","version":"0.0.0","private":true}\n');
  fs.writeFileSync(path.join(root, 'packages', 'agent-sdk', 'src', 'index.ts'), 'export {}\n');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { workspaces: string[] };
  fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ ...manifest, workspaces: [...manifest.workspaces, 'packages/*'] }, null, 2)}\n`);
  addModule({ root, name: 'loyalty' });
  return root;
}

const workflows = (root: string): { ci: string; verify: string } => {
  const targets = renderTargets(JSON.parse(fs.readFileSync(path.join(root, 'hfs.json'), 'utf8')), bundledPresets(), { source: appSource(root) });
  const body = (file: string): string => targets.find((target) => target.path === file)?.content ?? '';
  return { ci: body('.github/workflows/ci.yml'), verify: body('.github/workflows/cache-verify.yml') };
};

const stepNames = (doc: { jobs: Record<string, { steps?: { name?: string; run?: string; uses?: string }[] }> }, job: string): string[] =>
  (doc.jobs[job]?.steps ?? []).map((step) => step.name ?? step.uses ?? step.run ?? '');

test('the build command is the managed build:modules script, and its step renders only for an app with root packages', () => {
  assert.equal(BUILD_MODULES, 'npm run build:modules --silent');
  assert.equal(packagesBuildStep(false), '');
  assert.equal(packagesBuildStep(true), '      - name: build the workspace packages\n        run: npm run build:modules --silent');
  assert.equal(packagesBuildStep(true, 'x'), '      - name: build the workspace packages\n        if: x\n        run: npm run build:modules --silent');

  const bare = ciWorkflowCommands({ files: [] }, 'be/coverage/lcov.info', undefined, { packages: true });
  assert.equal(bare.ciPackagesBuild, '');
  assert.match(bare.ciLintSteps ?? '', /run: npm run codegen --silent && npx --no-install turbo run build --filter=\.\/fe\/packages\/\*\n/, 'an app without root packages lints as before');
  assert.doesNotMatch(`${bare.ciLintSteps}${bare.sonarJob}${bare.ciBuildSteps}`, /build:modules/);

  const built = ciWorkflowCommands({ files: [] }, 'be/coverage/lcov.info', undefined, { packages: true, rootPackages: true });
  assert.equal(built.ciPackagesBuild, packagesBuildStep(true));
  assert.match(built.ciLintSteps ?? '', /- name: build the lint inputs\n {8}run: npm run build:modules --silent && npm run codegen --silent && npx --no-install turbo run build --filter=\.\/fe\/packages\/\*\n/);
  const sonar = built.sonarJob ?? '';
  assert.ok(sonar.indexOf('build:modules') > 0 && sonar.indexOf('build:modules') < sonar.indexOf('SonarSource/sonarqube-scan-action'), 'the scan resolves the packages it imports, built');
});

test('a lite app with root packages builds them before its boot proof, on every lint side, before the scan and before the nightly verify; R301 accepts the render', (t) => {
  const root = app(t, true);
  const { ci, verify } = workflows(root);
  const doc = parseWorkflow(ci);
  const fast = stepNames(doc, 'fast');
  assert.ok(fast.indexOf('build the workspace packages') >= 0 && fast.indexOf('build the workspace packages') < fast.indexOf('boot proof'), fast.join(' | '));
  assert.ok(fast.indexOf('boot proof') < fast.indexOf('typecheck'), 'the boot proof still runs before the typecheck');
  assert.match(ci, /^ {8}side: \[be, fe, packages\]$/m);
  assert.match(ci, /- name: build the lint inputs\n {8}run: npm run build:modules --silent && npm run codegen --silent/);
  const sonar = stepNames(doc, 'sonar');
  assert.ok(sonar.indexOf('build the workspace packages') >= 0 && sonar.indexOf('build the workspace packages') < sonar.findIndex((name) => name.startsWith('SonarSource/sonarqube-scan-action@')), sonar.join(' | '));
  assert.deepEqual(ciStandardFindings({ doc, file: '.github/workflows/ci.yml', scope: 'app-ci', edition: 'lite', rootPackages: true }), []);
  const nightly = stepNames(parseWorkflow(verify), 'verify');
  assert.ok(nightly.indexOf('build the workspace packages') >= 0 && nightly.indexOf('build the workspace packages') < nightly.indexOf('verify the committed cache'), nightly.join(' | '));
});

test('a lite app without root packages renders no package build and no build:modules anywhere in its CI', (t) => {
  const root = app(t, false);
  const { ci, verify } = workflows(root);
  assert.doesNotMatch(ci, /build:modules|build the workspace packages/);
  assert.doesNotMatch(verify, /build:modules|build the workspace packages/);
  assert.match(ci, /^ {8}side: \[be, fe\]$/m);
  assert.deepEqual(ciStandardFindings({ doc: parseWorkflow(ci), file: '.github/workflows/ci.yml', scope: 'app-ci', edition: 'lite' }), []);
});
