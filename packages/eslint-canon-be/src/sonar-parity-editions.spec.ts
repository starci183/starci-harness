// proves: SCAN_SMELL@lite
// proves: SCAN_SMELL@full
import test from 'node:test';
import tsParser from '@typescript-eslint/parser';
import { rules } from './sonar-parity.ts';
import { canonRuleTester, ruleNamed } from '../fixtures/rule-tester.ts';

const tester = canonRuleTester({ languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: 'module' } });

for (const edition of ['lite', 'full']) {
  test(`${edition} accepts valid syntax and rejects every back-end Sonar smell`, () => {
    tester.run('max-params', ruleNamed(rules, 'max-params'), {
      valid: ['function seven(a, b, c, d, e, f, g) { return a }', '@Injectable() class Service { constructor(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) {} }'],
      invalid: [{ code: 'function eight(a, b, c, d, e, f, g, h) { return a }', errors: [{ messageId: 'many' }] }],
    });
    tester.run('no-await-in-loop', ruleNamed(rules, 'no-await-in-loop'), {
      valid: ['async function sendAll(items) { await Promise.all(items.map(send)) }'],
      invalid: [{ code: 'async function sendAll(items) { for (const item of items) await send(item) }', errors: [{ messageId: 'loop' }] }],
    });
    tester.run('prefer-code-point', ruleNamed(rules, 'prefer-code-point'), {
      valid: ['const point = text.codePointAt(0)'],
      invalid: [{ code: 'const point = text.charCodeAt(0)', errors: [{ messageId: 'codePoint' }] }],
    });
    tester.run('prefer-string-raw', ruleNamed(rules, 'prefer-string-raw'), {
      valid: ['const pattern = String.raw`plain pattern`'],
      invalid: [{ code: String.raw`const pattern = "a\\dir\\file"`, errors: [{ messageId: 'raw' }] }],
    });
    tester.run('no-nested-conditional', ruleNamed(rules, 'no-nested-conditional'), {
      valid: ['const choice = first ? one : two'],
      invalid: [{ code: 'const choice = first ? one : second ? two : three', errors: [{ messageId: 'nested' }] }],
    });
    tester.run('no-void-operator', ruleNamed(rules, 'no-void-operator'), {
      valid: ['void send()'],
      invalid: [{ code: 'void principal', errors: [{ messageId: 'void' }] }],
    });
    tester.run('no-unused-import', ruleNamed(rules, 'no-unused-import'), {
      valid: ["import { send } from 'transport'; export const result = send()"],
      invalid: [{ code: "import { send } from 'transport'", errors: [{ messageId: 'unused' }] }],
    });
    tester.run('prefer-export-from', ruleNamed(rules, 'prefer-export-from'), {
      valid: ["export { send } from 'transport'"],
      invalid: [{ code: "import { send } from 'transport'; export { send }", errors: [{ messageId: 'reexport' }] }],
    });
  });
}
