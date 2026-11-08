// proves: FE_CONNECTED_BLOCK_RENDER_PAIR@lite FE_CONNECTED_BLOCK_RENDER_PAIR@full
// proves: FE_WORLD_OWNER_RENDER_BOUNDARY@lite FE_WORLD_OWNER_RENDER_BOUNDARY@full
// A pure component may hand a ReactNode prop on as it is (the canon forbids the fragment that would wrap it), so a function whose
// every return is JSX, null or a read of its own props is a render target. A module value, a hook value or a call result is not.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { appDeclaration, archFixture, DEFAULT_APPS, findings, runArch } from './helpers/hfs-arch-fixture.mjs';

const BLOCK = 'apps/web/src/components/blocks/Frame';
const PAIR = 'FE_CONNECTED_BLOCK_RENDER_PAIR';
const OWNER = 'FE_WORLD_OWNER_RENDER_BOUNDARY';

const HEAD = 'import type { ReactNode } from "react";\nexport interface FrameBaseProps { readonly active: boolean; readonly candidate: ReactNode; readonly children?: ReactNode }\n';

const INDEX = [
  '"use client";',
  'import { useOrders } from "../../../hooks/orders";',
  'import { FrameBase } from "./component";',
  'export const Frame = (props: { readonly candidate: ReactNode }) => {',
  '  const orders = useOrders();',
  '  return <FrameBase active={orders > 0} candidate={props.candidate} />;',
  '};',
  '',
].join('\n').replace('"use client";', '"use client";\nimport type { ReactNode } from "react";');

function judged(t: TestContext, edition: string, component: string) {
  const declaration = { ...appDeclaration('fe', { apps: DEFAULT_APPS.fe }), edition };
  const report = runArch(archFixture(t, { profile: 'fe', files: {
    '../hfs.json': JSON.stringify(declaration),
    'apps/web/src/app/.keep': null,
    'apps/web/src/modules/config/index.ts': 'export const config = 1;\n',
    'apps/web/src/hooks/orders/index.ts': "export { useOrders } from './useOrders';\n",
    'apps/web/src/hooks/orders/useOrders.ts': 'export const useOrders = () => 1;\n',
    [`${BLOCK}/component.tsx`]: HEAD + component,
    [`${BLOCK}/index.tsx`]: INDEX,
  } }));
  return { pair: findings(report, PAIR).length, owner: findings(report, OWNER).length };
}

for (const edition of ['lite', 'full']) {
  const accepted: [string, string][] = [
    ['a conditional prop passthrough', 'export const FrameBase = (props: FrameBaseProps): ReactNode => (props.active ? props.candidate : null);'],
    ['a bare children passthrough', 'export const FrameBase = (props: FrameBaseProps): ReactNode => props.children;'],
    ['a destructured passthrough in a block body', 'export const FrameBase = ({ active, candidate }: FrameBaseProps): ReactNode => {\n  if (!active) return null;\n  return candidate;\n};'],
    ['the old fragment form', 'export const FrameBase = (props: FrameBaseProps) => <>{props.active ? props.candidate : null}</>;'],
  ];
  for (const [name, component] of accepted) {
    test(`${edition}: ${name} is a pure render target`, (t) => {
      assert.deepEqual(judged(t, edition, component), { pair: 0, owner: 0 });
    });
  }

  const refused: [string, string][] = [
    ['a module constant', 'const FIXED: ReactNode = null as ReactNode;\nexport const FrameBase = (props: FrameBaseProps): ReactNode => (props.active ? FIXED : null);'],
    ['a hook value', 'import { useOrders } from "../../../hooks/orders";\nexport const FrameBase = (props: FrameBaseProps): ReactNode => (props.active ? (useOrders() as unknown as ReactNode) : null);'],
    ['a call result', 'declare const pick: (node: ReactNode) => ReactNode;\nexport const FrameBase = (props: FrameBaseProps): ReactNode => pick(props.candidate);'],
    ['only null', 'export const FrameBase = (props: FrameBaseProps): ReactNode => (props.active ? null : null);'],
  ];
  for (const [name, component] of refused) {
    test(`${edition}: ${name} is not a pure render target`, (t) => {
      const result = judged(t, edition, component);
      assert.equal(result.owner, 1);
    });
  }
}
