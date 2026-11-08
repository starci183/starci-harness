// `starci app codemod common-base`: the app's own DomainError, ErrorKind, ErrorParams, DomainErrorInit, Outcome, isRecord and eachInOrder become re-exports of
// @starci/common (every `@modules/platform/errors` import stays), the app gains the dependency, and a root package that declares starci.errorBase is left to a person.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CODEMODS, codemodMain } from '../codemod/main.mjs';
import { commonBaseMarkdown, migrateCommonBase, transformErrorContracts } from '../codemod/common-base.mjs';

const LEGACY: Record<string, string> = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'fixtures', 'common-base-legacy.json'), 'utf8')); // reason: parsed fixture of the pre-@starci/common template files

/** An app root with the legacy platform files, a root package.json and one root package, in a temp folder. */
function legacyApp(options: { errorBase?: boolean; edit?: Record<string, string> } = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-common-base-'));
  const write = (file: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
  for (const [file, text] of Object.entries(LEGACY)) write(`be/src/modules/platform/${file}`, options.edit?.[file] ?? text);
  write('package.json', `${JSON.stringify({ name: 'app', dependencies: { zod: '4.0.0' } }, null, 2)}\n`);
  write('packages/agent/package.json', `${JSON.stringify({ name: '@app/agent', ...(options.errorBase === true ? { starci: { errorBase: { name: 'AgentError', file: 'src/errors.ts' } } } : {}) })}\n`);
  return root;
}
const read = (root: string, file: string) => fs.readFileSync(path.join(root, 'be/src/modules/platform', file), 'utf8');

test('common-base is one of the codemods', () => {
  assert.ok(CODEMODS.includes('common-base'));
});

test('a dry run reports every rewrite and writes nothing', () => {
  const root = legacyApp();
  const report = migrateCommonBase({ root });
  assert.equal(report.write, false);
  assert.equal(report.filesChanged.length, 6);
  assert.equal(report.dependency.declared, false);
  assert.equal(report.dependency.added, false);
  assert.equal(read(root, 'errors/domain.error.ts'), LEGACY['errors/domain.error.ts']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).dependencies['@starci/common'], undefined); // reason: parsed manifest
  assert.match(commonBaseMarkdown(report), /would be rewritten/);
});

test('--execute turns the six template files into re-exports and adds the dependency', () => {
  const root = legacyApp();
  const report = migrateCommonBase({ root, write: true });
  assert.deepEqual(report.findings, []);
  assert.equal(read(root, 'errors/domain.error.ts'), 'export { DomainError, isDomainError } from "@starci/common"\n');
  assert.equal(read(root, 'primitives/outcome.mapper.ts'), 'export { ok, refused, unwrapOutcome } from "@starci/common"\n');
  assert.equal(read(root, 'primitives/outcome.contracts.ts'), 'export type { Outcome, OutcomeErrorClass, OutcomeOk, OutcomeRefused } from "@starci/common"\n');
  assert.equal(read(root, 'primitives/record.policy.ts'), 'export { isRecord } from "@starci/common"\n');
  assert.equal(read(root, 'primitives/sequence.policy.ts'), 'export { eachInOrder } from "@starci/common"\n');
  const contracts = read(root, 'errors/errors.contracts.ts');
  assert.match(contracts, /^import type \{ ErrorKind, ErrorParams \} from "@starci\/common"\n\nexport type \{ DomainErrorInit, ErrorKind, ErrorParams \} from "@starci\/common"\n\n\/\*\* One capability's exhaustive/);
  assert.doesNotMatch(contracts, /export interface (?:ErrorParams|DomainErrorInit)|export type ErrorKind =/);
  assert.match(contracts, /export type ErrorKindTable/);
  assert.match(contracts, /export interface ErrorDescription/);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); // reason: parsed manifest
  assert.deepEqual(Object.keys(manifest.dependencies), ['@starci/common', 'zod']);
  assert.match(manifest.dependencies['@starci/common'], /^\d+\.\d+\.\d+$/);
  assert.equal(report.dependency.added, true);
});

test('a second run finds nothing to do', () => {
  const root = legacyApp();
  migrateCommonBase({ root, write: true });
  const again = migrateCommonBase({ root, write: true });
  assert.deepEqual(again.filesChanged, []);
  assert.deepEqual(again.findings, []);
  assert.equal(again.dependency.declared, true);
  assert.match(commonBaseMarkdown(again), /declared/);
});

test('a file that no longer declares what the package owns, and contracts off the template, are left for a person', () => {
  const root = legacyApp({ edit: { 'errors/domain.error.ts': 'export class SomethingElse {}\n', 'errors/errors.contracts.ts': 'export type ErrorKind = "a" | "b"\n' } });
  const report = migrateCommonBase({ root, write: true });
  assert.deepEqual(report.findings.map((finding) => finding.code).sort(), ['COMMON_BASE_CONTRACTS_CUSTOM', 'COMMON_BASE_FILE_CUSTOM']);
  assert.equal(read(root, 'errors/domain.error.ts'), 'export class SomethingElse {}\n');
  assert.match(commonBaseMarkdown(report), /Left for a person/);
  assert.equal(transformErrorContracts('export type ErrorKind = "a"\n'), null);
});

test('a root package that declares starci.errorBase is a finding', () => {
  const root = legacyApp({ errorBase: true });
  const report = migrateCommonBase({ root });
  assert.deepEqual(report.findings.map((finding) => [finding.file, finding.code]), [['packages/agent/package.json', 'COMMON_BASE_ERROR_BASE']]);
});

test('an app without a back end is refused, and the codemod verb runs it', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-common-base-'));
  assert.throws(() => migrateCommonBase({ root: empty }), /be\/ directory/);
  const root = legacyApp();
  let out = '';
  const code = await codemodMain(['common-base', '--json'], { cwd: root, stdout: (text) => { out += text; } });
  assert.equal(code, 0);
  assert.equal(JSON.parse(out).schema, 'starci/common-base-report@1'); // reason: the verb's own JSON report
});
