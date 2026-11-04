// The lint job of the managed CI outlasts the ESLint child of its largest side: the CLI's liveness budget of that child (handed to sync as
// STARCI_ESLINT_TIMEOUT_MINUTES and STARCI_ESLINT_MINUTES_PER_1000_FILES) plus lintOverheadMinutes of the CI standard, so a cold run of an
// 11k-file back end on a 2-core runner ends by its own budget, never killed by a flat job timeout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ciWorkflowCommands, eslintBudgetMinutes, lintJobTimeout } from '../sync/ci-commands.mjs';

const CLI_ENV = { STARCI_ESLINT_TIMEOUT_MINUTES: '10', STARCI_ESLINT_MINUTES_PER_1000_FILES: '5' };
const files = (side: string, count: number): string[] => Array.from({ length: count }, (_, index) => `${side}/src/file-${String(index)}.ts`);

test('the ESLint budget is the CLI rule: max(base, rate x files / 1000), and none outside the CLI', () => {
  assert.equal(eslintBudgetMinutes(11_346, CLI_ENV), 56.73);
  assert.equal(eslintBudgetMinutes(500, CLI_ENV), 10);
  assert.equal(eslintBudgetMinutes(11_346, { STARCI_ESLINT_TIMEOUT_MINUTES: '10' }), 10, 'no rate: the base');
  assert.equal(eslintBudgetMinutes(11_346, {}), null);
});

test('an 11k-file back end gets a lint job timeout above its ESLint budget; a small app keeps the default; a declared timeout wins', () => {
  const big = lintJobTimeout({ declared: undefined, fallback: 30, overhead: 20, scopeFiles: [11_346, 3_852], env: CLI_ENV });
  assert.ok(big > (eslintBudgetMinutes(11_346, CLI_ENV) ?? 0), `${String(big)} minutes outlast the budget`);
  assert.equal(big, 77);
  assert.equal(lintJobTimeout({ declared: undefined, fallback: 30, overhead: 20, scopeFiles: [800, 400], env: CLI_ENV }), 30);
  assert.equal(lintJobTimeout({ declared: 45, fallback: 30, overhead: 20, scopeFiles: [11_346], env: CLI_ENV }), 45);
  assert.equal(lintJobTimeout({ declared: undefined, fallback: 30, overhead: 20, scopeFiles: [11_346], env: {} }), 30, 'outside the CLI the default stands');
});

test('the rendered CI takes the timeout of its largest side from the tracked files, and only script sources count', () => {
  const saved = { ...process.env };
  Object.assign(process.env, CLI_ENV);
  try {
    const source = { files: [...files('be', 11_346), ...files('fe', 3_852), ...Array.from({ length: 5_000 }, (_, index) => `be/fixtures/data-${String(index)}.json`)] };
    assert.equal(ciWorkflowCommands(source).timeoutLint, '77');
    assert.equal(ciWorkflowCommands({ files: files('be', 900) }).timeoutLint, '30');
  } finally {
    for (const key of Object.keys(CLI_ENV)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});
