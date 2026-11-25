// A lint warning is report-only (owner 2026-11-25, PROJECT-LINT-6): the style rules of the canon ship at `warn`, so the check cache replays a recorded finding
// at the level its rule has in the canon installed now, and the Sonar import, whose gate fails on any imported issue, carries the errors only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { canonSeverity, toEslint, type CanonDeclarations } from '../cache/lint-family.mjs';
import { linterReport } from '../report/sonar.mjs';

const canon = (levels?: Record<string, 'error' | 'warn'>): CanonDeclarations => ({ name: 'fixture', crossFileInputs: [], graphRules: false, projectGraph: null, ...(levels === undefined ? {} : { levels }) });

test('a replayed finding takes the level its rule has in the canon installed now, never the one of the run that recorded it', () => {
  const record = {
    path: 'src/a.ts', step: 'eslint', hash: 'h',
    findings: [
      { path: 'be/src/a.ts', line: 1, column: 1, rule: 'starci-be/require-export-jsdoc', message: 'jsdoc' },
      { path: 'be/src/a.ts', line: 2, column: 1, rule: '@typescript-eslint/no-floating-promises', message: 'await it' },
      { path: 'be/src/a.ts', line: 3, column: 1, rule: 'eslint-error', message: 'parse error' },
    ],
    data: { ends: [] },
  };
  const now = toEslint('/app/be', 'src/a.ts', record, canonSeverity([canon({ 'starci-be/require-export-jsdoc': 'warn', '@typescript-eslint/no-floating-promises': 'error' })]));
  assert.deepEqual(now.messages.map((message) => [message.ruleId, message.severity]), [
    ['starci-be/require-export-jsdoc', 1], ['@typescript-eslint/no-floating-promises', 2], [null, 2],
  ]);
  const raised = toEslint('/app/be', 'src/a.ts', record, canonSeverity([canon({ 'starci-be/require-export-jsdoc': 'error' })]));
  assert.equal(raised.messages[0]?.severity, 2, 'a rule the canon raised to error is replayed as an error');
  assert.equal(toEslint('/app/be', 'src/a.ts', record, canonSeverity([canon()])).messages[0]?.severity, 2, 'a canon that publishes no levels replays errors');
  assert.equal(canonSeverity([canon({ x: 'warn' }), canon({ x: 'error' })])('x'), 2, 'a rule one canon asks at error is an error');
});

test('the Sonar import carries the linter errors only: an ESLint or stylelint warning stays report-only', () => {
  const eslint = linterReport('eslint', [{ filePath: 'be/src/a.ts', messages: [
    { ruleId: 'starci-be/require-export-jsdoc', severity: 1, line: 1, message: 'style' },
    { ruleId: '@typescript-eslint/no-floating-promises', severity: 2, line: 2, message: 'bug' },
  ] }], { root: '.' });
  assert.deepEqual(eslint.issues.map((issue) => issue.ruleId), ['@typescript-eslint/no-floating-promises']);
  assert.deepEqual(eslint.rules.map((rule) => rule.id), ['@typescript-eslint/no-floating-promises'], 'a warning adds no rule either');
  const stylelint = linterReport('stylelint', [{ source: 'fe/a.css', warnings: [
    { rule: 'a', severity: 'warning', line: 1, text: 'soft' },
    { rule: 'b', severity: 'error', line: 2, text: 'hard' },
  ] }], { root: '.' });
  assert.deepEqual(stylelint.issues.map((issue) => issue.ruleId), ['b']);
});
