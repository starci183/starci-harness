// proves: BE_FEATURE_SHAPE@lite
// proves: BE_FEATURE_SHAPE@full
// proves: BE_FEATURE_LAYOUT_INVALID@lite
// proves: BE_FEATURE_LAYOUT_INVALID@full
// proves: BE_APPLICATION_IMPORTS_TRANSPORT@lite
// proves: BE_APPLICATION_IMPORTS_TRANSPORT@full
// proves: BE_APPLICATION_TRANSPORT_FRAMEWORK@lite
// proves: BE_APPLICATION_TRANSPORT_FRAMEWORK@full
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { projectFixture } from '../fixtures/project/tester.ts';
import { rules } from './project-graph.ts';
import { checkFeatureShape } from '../runtime/scripts/hfs/architecture/feature-shape.mjs';
import { openHfs } from '../runtime/scripts/hfs/slots.mjs';
import type { TestContext } from "node:test"
import type { ProjectFixture } from "../fixtures/project/tester.ts"
import { ruleNamed } from '../fixtures/rule-tester.ts';

const FEATURE = 'src/features/api/orders';
const VALUE = 'export const value = 1;\n';
const runtimeRoot = fileURLToPath(new URL('../runtime/', import.meta.url));
const shape = (f: ProjectFixture) => checkFeatureShape({
  config: { root: f.root }, graph: { resolver: openHfs({ root: runtimeRoot, repoRoot: f.root }) },
});

function fixture(t: TestContext, edition: "full" | "lite", files: Readonly<Record<string, string>>) {
  const result = projectFixture({ edition, files });
  t.after(result.cleanup);
  return result;
}

/** The text of a fixture file the spec wrote (a spec naming a file it did not write fails here, as the tester would). */
const textAt = (files: Readonly<Record<string, string>>, rel: string) => {
  const text = files[rel];
  if (text === undefined) throw new Error(`no fixture file ${rel}`);
  return text;
};

const passing = (f: ProjectFixture, files: Readonly<Record<string, string>>, rel: string) => ({ filename: f.at(rel), code: textAt(files, rel) });
const violating = (f: ProjectFixture, files: Readonly<Record<string, string>>, rel: string, code: string) => ({
  ...passing(f, files, rel), errors: [{ message: new RegExp(code), line: 1 }],
});

for (const edition of ['lite', 'full'] as const) {
  test(`passing ${edition} feature files occupy their allowed slots`, t => {
    const files = {
      [`${FEATURE}/index.ts`]: VALUE,
      [`${FEATURE}/orders.module.ts`]: VALUE,
      [`${FEATURE}/application/run.command.ts`]: VALUE,
      [`${FEATURE}/application/run.handler.ts`]: VALUE,
      [`${FEATURE}/transport/http/orders-http.module.ts`]: VALUE,
      [`${FEATURE}/transport/http/orders.controller.ts`]: VALUE,
    };
    const f = fixture(t, edition, files);
    assert.deepEqual(shape(f).violations.filter(item => item.ruleId === 'BE_FEATURE_SHAPE'), []);
  });

  test(`violating ${edition} feature root refuses an unowned file`, t => {
    const f = fixture(t, edition, {
      [`${FEATURE}/index.ts`]: VALUE,
      [`${FEATURE}/helper.ts`]: VALUE,
    });
    assert.deepEqual(shape(f).violations.filter(item => item.ruleId === 'BE_FEATURE_SHAPE').map(item => item.ruleId), ['BE_FEATURE_SHAPE']);
  });

  test(`passing and violating ${edition} feature roles stay in their folders`, t => {
    assert.doesNotThrow(() => {
      const good = `${FEATURE}/transport/http/orders.controller.ts`;
      const bad = `${FEATURE}/orders.controller.ts`;
      const files = { [`${FEATURE}/index.ts`]: VALUE, [good]: VALUE, [bad]: VALUE };
      const f = fixture(t, edition, files);
      f.tester.run('feature-layout', ruleNamed(rules, 'feature-layout'), {
        valid: [passing(f, files, good)],
        invalid: [violating(f, files, bad, 'BE_FEATURE_LAYOUT_INVALID')],
      });
    })
  });

  test(`passing and violating ${edition} application code is independent of transport`, t => {
    assert.doesNotThrow(() => {
      const good = `${FEATURE}/application/run.handler.ts`;
      const adapter = `${FEATURE}/application/adapter.handler.ts`;
      const framework = `${FEATURE}/application/framework.handler.ts`;
      const files = {
        [`${FEATURE}/index.ts`]: VALUE,
        [good]: VALUE,
        [adapter]: "import { controller } from '../transport/http/orders.controller';\nexport const handler = controller;\n",
        [framework]: "import { Resolver } from '@nestjs/graphql';\nexport const handler = Resolver;\n",
        [`${FEATURE}/transport/http/orders.controller.ts`]: 'export const controller = 1;\n',
      };
      const f = fixture(t, edition, files);
      f.tester.run('application-never-imports-transport', ruleNamed(rules, 'application-never-imports-transport'), {
        valid: [passing(f, files, good)],
        invalid: [
          violating(f, files, adapter, 'BE_APPLICATION_IMPORTS_TRANSPORT'),
          violating(f, files, framework, 'BE_APPLICATION_TRANSPORT_FRAMEWORK'),
        ],
      });
    })
  });

}
