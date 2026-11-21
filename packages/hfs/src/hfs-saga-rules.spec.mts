// The declared-pattern mechanism of the saga slots (`patterns: ["saga"]` in hfs.json sides.be): an undeclared saga folder is HFS_SLOT_NOT_ENABLED.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { checkRepo } from '../runtime/scripts/hfs/check.mjs';
import type { CheckFinding } from '../runtime/scripts/hfs/check.mjs';
import { loadSlotManifest, resolveRepoDeclaration } from '../runtime/scripts/hfs/slots.mjs';
import { appOf, cleanup, gitAdd, writeCleanRepo } from './helpers/hfs-cli-fixture.mjs';
import type { AppDeclaration } from './helpers/hfs-cli-fixture.mjs';

const OPTIONAL = ['be.contract.events', 'be.transport.message'];
const WITH_SAGA = appOf({ be: { apps: [{ name: 'core', kind: 'api' }], optionalSlots: OPTIONAL, patterns: ['saga'] } });
const WITHOUT_PATTERN = appOf({ be: { apps: [{ name: 'core', kind: 'api' }], optionalSlots: OPTIONAL } });
const made: string[] = [];
const repoOf = (declaration: AppDeclaration, mutate?: (dir: string) => void) => {
  const dir = writeCleanRepo(declaration);
  made.push(dir);
  if (mutate) mutate(dir);
  return gitAdd(dir);
};
test.after(() => cleanup(made));

const put = (dir: string, relative: string, text = 'export {};\n') => {
  const target = path.join(dir, ...relative.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
};
const run = (declaration: AppDeclaration, mutate?: (dir: string) => void) => checkRepo({ repoRoot: repoOf(declaration, mutate) }).findings;
const only = (findings: CheckFinding[], code: string) => findings.filter((f) => f.code === code);

const SAGA = 'be/src/features/saga/place/';
const STEP = `${SAGA}steps/reserve.saga-step.ts`;
const COMPENSATION = `${SAGA}compensations/reserve.compensation.ts`;
const ORCHESTRATOR = `${SAGA}place.saga.service.ts`;
const STATE = `${SAGA}place.saga-state.ts`;

const STEP_TS = 'export class ReserveStep {\n  readonly event = "order.placed"\n}\n';
const COMPENSATION_TS = 'export class ReserveCompensation {\n  readonly event = "billing.invoice-rejected"\n}\n';
const ORCHESTRATOR_TS = "import { SagaService } from '../../../modules/platform/saga';\nimport { ReserveStep } from './steps/reserve.saga-step';\nimport { ReserveCompensation } from './compensations/reserve.compensation';\nexport class PlaceSaga { constructor(readonly s: SagaService, readonly a: ReserveStep, readonly b: ReserveCompensation) {} }\n";
const STATE_TS = "export interface PlaceSagaState {\n  readonly status: 'running' | 'compensated'\n  readonly version: number\n}\n";
/** A saga: orchestrator, state, one step with its compensation; `override` replaces or (null) removes a file. */
const sagaRepo = (override: Record<string, string | null> = {}) => (dir: string) => {
  const files = { [STEP]: STEP_TS, [COMPENSATION]: COMPENSATION_TS, [ORCHESTRATOR]: ORCHESTRATOR_TS, [STATE]: STATE_TS, ...override };
  for (const [file, text] of Object.entries(files)) if (text !== null) put(dir, file, text);
};

// ------------------------------------------------------------------------------------------------ the declared pattern

test('the saga slots are enabled only by the declared pattern: an undeclared saga folder is HFS_SLOT_NOT_ENABLED', () => {
  const comparePaths = (left: string, right: string) => left.localeCompare(right);
  const undeclared = only(run(WITHOUT_PATTERN, sagaRepo()), 'HFS_SLOT_NOT_ENABLED').map((f) => f.path!).filter((file) => file.includes('/saga/')).sort(comparePaths);
  assert.deepEqual(undeclared, [COMPENSATION, ORCHESTRATOR, STATE, STEP].sort(comparePaths));
  assert.deepEqual(only(run(WITH_SAGA, sagaRepo()), 'HFS_SLOT_NOT_ENABLED'), []);
});

test('a pattern absent from both slots and proof scenarios is refused in hfs.json', () => {
  const declaration = appOf({ be: { apps: [{ name: 'core', kind: 'api' }], patterns: ['no-such-pattern'] } });
  assert.throws(() => resolveRepoDeclaration(loadSlotManifest(), declaration), /patterns names no-such-pattern/);
  assert.doesNotThrow(() => resolveRepoDeclaration(loadSlotManifest(), WITH_SAGA));
});
