// proves: FE_WIRE_GENERATED@lite
// proves: FE_WIRE_GENERATED@full
import test from 'node:test';
import { RuleTester } from 'eslint';
import parser from '@typescript-eslint/parser';
import { noHandTypedWire } from './transport.ts';
import { at, fixtureHfs, LITE_FE_DECLARATION } from '../fixtures/typed/tester.ts';

// The tree-level FE_WIRE_GENERATED cases (codegen script, generated output, schema stamp) judge @starci/hfs's
// appFrontendFindings and stay with that package; this file proves the lint rule only.
for (const edition of ['lite', 'full']) {
  test(`${edition} accepts generated or unknown response types and rejects handwritten wire claims`, () => {
    const hfs = fixtureHfs(edition === 'lite' ? LITE_FE_DECLARATION : undefined, { lite: edition === 'lite' });
    const tester = new RuleTester({
      languageOptions: { parser, ecmaVersion: 2022, sourceType: 'module' },
      settings: { starci: { hfs } },
    });
    const filename = at('apps/web/src/modules/api/graphql/queries/query-ping.ts');
    tester.run('no-hand-typed-wire', noHandTypedWire, {
      valid: [
        { filename, code: 'const body = (await response.json()) as unknown' },
        { filename, code: 'import type { PingQuery } from "../__generated__/graphql"; const body: PingQuery = await response.json()' },
        { filename, code: 'export const ping = "query Ping { ping }"' },
      ],
      invalid: [
        { filename, code: 'const body = (await response.json()) as PingQuery', errors: [{ messageId: 'cast' }] },
        { filename, code: 'const body: PingQuery = await response.json()', errors: [{ messageId: 'cast' }] },
        { filename: at('apps/web/src/hooks/ping/usePing.ts'), code: 'const ping = "query Ping { ping }"', errors: [{ messageId: 'document' }] },
      ],
    });
  });
}
