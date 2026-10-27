// proves: SCAN_SMELL@lite
// proves: SCAN_SMELL@full
import test from 'node:test';
import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { canonTester } from '../fixtures/typed/tester.ts';
import type { Rule } from './lib/rule.ts';
import { rules } from './sonar-parity.ts';

/** The rule the law publishes as `name`; a missing one fails the run. */
const ruleOf = (name: string): Rule => {
  const rule = rules[name];
  if (rule === undefined) throw new Error(`sonar-parity publishes no ${name}`);
  return rule;
};

const tester = canonTester(new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
}));

for (const edition of ['lite', 'full']) {
  test(`${edition} accepts valid syntax and rejects every front-end Sonar smell`, () => {
    tester.run('no-await-in-loop', ruleOf('no-await-in-loop'), {
      valid: ['async function sendAll(items) { await Promise.all(items.map(send)) }'],
      invalid: [{ code: 'async function sendAll(items) { for (const item of items) await send(item) }', errors: [{ messageId: 'loop' }] }],
    });
    tester.run('prefer-code-point', ruleOf('prefer-code-point'), {
      valid: ['const point = text.codePointAt(0)'],
      invalid: [{ code: 'const point = text.charCodeAt(0)', errors: [{ messageId: 'codePoint' }] }],
    });
    tester.run('prefer-string-raw', ruleOf('prefer-string-raw'), {
      valid: ['const pattern = String.raw`plain pattern`'],
      invalid: [{ code: String.raw`const pattern = "a\\dir\\file"`, errors: [{ messageId: 'raw' }] }],
    });
    tester.run('no-nested-conditional', ruleOf('no-nested-conditional'), {
      valid: ['const choice = first ? one : two'],
      invalid: [{ code: 'const choice = first ? one : second ? two : three', errors: [{ messageId: 'nested' }] }],
    });
    tester.run('no-void-operator', ruleOf('no-void-operator'), {
      valid: ['void send()'],
      invalid: [{ code: 'void principal', errors: [{ messageId: 'void' }] }],
    });
    tester.run('no-unused-import', ruleOf('no-unused-import'), {
      valid: ["import { send } from 'transport'; export const result = send()"],
      invalid: [{ code: "import { send } from 'transport'", errors: [{ messageId: 'unused' }] }],
    });
    tester.run('prefer-export-from', ruleOf('prefer-export-from'), {
      valid: ["export { send } from 'transport'"],
      invalid: [{ code: "import { send } from 'transport'; export { send }", errors: [{ messageId: 'reexport' }] }],
    });
    tester.run('no-unused-prop-types', ruleOf('no-unused-prop-types'), {
      valid: ['type Props = { title: string }; const Title = (props: Props) => <h1>{props.title}</h1>'],
      invalid: [{ code: 'type Props = { title: string; note: string }; const Title = (props: Props) => <h1>{props.title}</h1>', errors: [{ messageId: 'unused' }] }],
    });
    tester.run('max-params', ruleOf('max-params'), {
      valid: ['function seven(a, b, c, d, e, f, g) { return a }'],
      invalid: [{ code: 'function eight(a, b, c, d, e, f, g, h) { return a }', errors: [{ messageId: 'many' }] }],
    });
    tester.run('media-has-caption', ruleOf('media-has-caption'), {
      valid: ['const Clip = () => <video src="a.mp4"><track kind="captions" src="a.vtt" /></video>'],
      invalid: [{ code: 'const Clip = () => <video src="a.mp4" />', errors: [{ messageId: 'caption' }] }],
    });
  });
}
