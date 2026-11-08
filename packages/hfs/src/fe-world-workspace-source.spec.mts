// proves: FE_WORLD_OWNER_RENDER_BOUNDARY@lite FE_WORLD_OWNER_RENDER_BOUNDARY@full
// An fe app reaches a workspace package's SOURCE through a tsconfig path alias (`@fixture/blocks-core` ->
// `packages/blocks-core/src/index.ts`, outside the fe root). The world analysis follows a call into that file, which no checker
// of the context holds (the context keeps only files under the fe root). The package is its own unit, judged by its own lint, so
// the analysis treats the declaration as outside the app's world: it neither throws `No type checker holds ...` nor reports it.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { appDeclaration, archFixture, DEFAULT_APPS, findings, runArch } from './helpers/hfs-arch-fixture.mjs';

const OWNER = 'FE_WORLD_OWNER_RENDER_BOUNDARY';
const OWNERSHIP = 'FE_COMPONENT_WORLD_OWNERSHIP';
const LEAF = 'apps/web/src/components/leaves/Label';

const PACKAGE = {
  '../packages/blocks-core/package.json': JSON.stringify({ name: '@fixture/blocks-core', private: true }),
  '../packages/blocks-core/src/index.ts': "export { messageLabel } from './agent-message/agent-message-item';\n",
  '../packages/blocks-core/src/agent-message/format.ts': 'export const trimmed = (text: string): string => text.trim();\n',
  // The package function calls another function of its own: walking it would need a checker for this file.
  '../packages/blocks-core/src/agent-message/agent-message-item.ts':
    "import { trimmed } from './format';\nexport function messageLabel(text: string): string {\n  return trimmed(text).toUpperCase();\n}\n",
};

function judged(t: TestContext, edition: string, component: string) {
  const declaration = { ...appDeclaration('fe', { apps: DEFAULT_APPS.fe }), edition };
  const root = archFixture(t, { profile: 'fe', files: {
    '../hfs.json': JSON.stringify(declaration),
    'apps/web/tsconfig.json': JSON.stringify({
      extends: '../../tsconfig.json',
      compilerOptions: { baseUrl: '.', paths: { '@fixture/blocks-core': ['../../../packages/blocks-core/src/index.ts'] } },
      include: ['src/**/*'],
    }),
    'apps/web/src/modules/config/index.ts': 'export const config = 1;\n',
    ...PACKAGE,
    [`${LEAF}/index.tsx`]: component,
  } });
  return runArch(root);
}

for (const edition of ['lite', 'full']) {
  test(`${edition}: a component calling a workspace package source through a path alias is analysed without error`, (t) => {
    const report = judged(t, edition, [
      'import { messageLabel } from "@fixture/blocks-core";',
      'export const Label = (props: { readonly text: string }) => <span>{messageLabel(props.text)}</span>;',
      '',
    ].join('\n'));
    assert.deepEqual([findings(report, OWNER).length, findings(report, OWNERSHIP).length], [0, 0]);
  });
}
