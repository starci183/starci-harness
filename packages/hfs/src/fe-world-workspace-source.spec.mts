// proves: FE_WORLD_OWNER_RENDER_BOUNDARY@lite FE_WORLD_OWNER_RENDER_BOUNDARY@full
// An fe app reaches a workspace package's SOURCE through a tsconfig path alias (`@fixture/ui-kit` ->
// `packages/ui-kit/src/index.ts`, outside the fe root). The world analysis follows a call into that file, which no checker
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
  '../packages/ui-kit/package.json': JSON.stringify({ name: '@fixture/ui-kit', private: true }),
  '../packages/ui-kit/src/index.ts': "export { messageLabel } from './agent-message/agent-message-item';\n",
  '../packages/ui-kit/src/agent-message/format.ts': 'export const trimmed = (text: string): string => text.trim();\n',
  // The package function calls another function of its own: walking it would need a checker for this file.
  '../packages/ui-kit/src/agent-message/agent-message-item.ts':
    "import { trimmed } from './format';\nexport function messageLabel(text: string): string {\n  return trimmed(text).toUpperCase();\n}\n",
};

function judged(t: TestContext, edition: string, component: string) {
  const declaration = { ...appDeclaration('fe', { apps: DEFAULT_APPS.fe }), edition };
  const root = archFixture(t, { profile: 'fe', files: {
    '../hfs.json': JSON.stringify(declaration),
    'apps/web/tsconfig.json': JSON.stringify({
      extends: '../../tsconfig.json',
      compilerOptions: { baseUrl: '.', paths: { '@fixture/ui-kit': ['../../../packages/ui-kit/src/index.ts'] } },
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
      'import { messageLabel } from "@fixture/ui-kit";',
      'export const Label = (props: { readonly text: string }) => <span>{messageLabel(props.text)}</span>;',
      '',
    ].join('\n'));
    assert.deepEqual([findings(report, OWNER).length, findings(report, OWNERSHIP).length], [0, 0]);
  });
}

// A package variable aliasing another binding (`export const usePackageThing = impl`) is followed to its initializer, whose file no checker of the context holds
// either: the initializer is another unit's code, outside the app's world, and is neither analysed nor a crash (`No type checker holds <file>`).
const ALIASED = {
  '../packages/ui-kit/src/index.ts': "export { usePackageThing } from './aliased';\n",
  '../packages/ui-kit/src/aliased.ts': "const implementation = (text: string): string => text.trim();\nexport const usePackageThing = implementation;\n",
};

for (const edition of ['lite', 'full']) {
  test(`${edition}: a component calling a workspace package's aliased variable through a path alias is analysed without error`, (t) => {
    const declaration = { ...appDeclaration('fe', { apps: DEFAULT_APPS.fe }), edition };
    const root = archFixture(t, { profile: 'fe', files: {
      '../hfs.json': JSON.stringify(declaration),
      'apps/web/tsconfig.json': JSON.stringify({
        extends: '../../tsconfig.json',
        compilerOptions: { baseUrl: '.', paths: { '@fixture/ui-kit': ['../../../packages/ui-kit/src/index.ts'] } },
        include: ['src/**/*'],
      }),
      'apps/web/src/modules/config/index.ts': 'export const config = 1;\n',
      '../packages/ui-kit/package.json': PACKAGE['../packages/ui-kit/package.json'],
      ...ALIASED,
      [`${LEAF}/index.tsx`]: [
        'import { usePackageThing } from "@fixture/ui-kit";',
        'export const Label = (props: { readonly text: string }) => <span>{usePackageThing(props.text)}</span>;',
        '',
      ].join('\n'),
    } });
    const report = runArch(root);
    assert.deepEqual([findings(report, OWNER).length, findings(report, OWNERSHIP).length], [0, 0]);
  });
}
