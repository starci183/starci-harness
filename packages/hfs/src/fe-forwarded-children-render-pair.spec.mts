// proves: FE_CONNECTED_BLOCK_RENDER_PAIR@lite FE_CONNECTED_BLOCK_RENDER_PAIR@full
// proves: FE_WORLD_OWNER_RENDER_BOUNDARY@lite FE_WORLD_OWNER_RENDER_BOUNDARY@full
// A connected block forwards the children it receives to its pure Base as `children={props.children}` or nested between the tags
// as `<XBase>{props.children}</XBase>`; the two are one render path. Anything else between the tags is not forwarded children.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { appDeclaration, archFixture, DEFAULT_APPS, findings, runArch } from './helpers/hfs-arch-fixture.mjs';

const BLOCK = 'apps/web/src/components/blocks/Frame';
const PAIR = 'FE_CONNECTED_BLOCK_RENDER_PAIR';
const OWNER = 'FE_WORLD_OWNER_RENDER_BOUNDARY';

const COMPONENT = [
  'import type { ReactNode } from "react";',
  'export interface FrameBaseProps { readonly props: { readonly title: string }; readonly children?: ReactNode }',
  'export const FrameBase = (input: FrameBaseProps) => <section>{input.props.title}{input.children}</section>;',
  '',
].join('\n');

/** The connected half of Frame with the given head of its parameters and the JSX it returns. */
const connected = (parameters: string, jsx: string) => [
  '"use client";',
  'import type { ReactNode } from "react";',
  'import { useOrders } from "../../../hooks/orders";',
  'import { FrameBase } from "./component";',
  `export const Frame = (${parameters}) => {`,
  '  const orders = useOrders();',
  `  return ${jsx};`,
  '};',
  '',
].join('\n');

const BY_PROPS = 'props: { readonly children?: ReactNode }';
const BY_DESTRUCTURE = '{ children }: { readonly children?: ReactNode }';

function fixture(t: TestContext, edition: string, index: string) {
  const declaration = { ...appDeclaration('fe', { apps: DEFAULT_APPS.fe }), edition };
  return archFixture(t, { profile: 'fe', files: {
    '../hfs.json': JSON.stringify(declaration),
    'apps/web/src/app/.keep': null,
    'apps/web/src/modules/config/index.ts': 'export const config = 1;\n',
    'apps/web/src/hooks/orders/index.ts': "export { useOrders } from './useOrders';\n",
    'apps/web/src/hooks/orders/useOrders.ts': 'export const useOrders = () => 1;\n',
    [`${BLOCK}/component.tsx`]: COMPONENT,
    [`${BLOCK}/index.tsx`]: index,
  } });
}

const judged = (t: TestContext, edition: string, index: string) => {
  const report = runArch(fixture(t, edition, index));
  return { pair: findings(report, PAIR).length, owner: findings(report, OWNER).length };
};

for (const edition of ['lite', 'full']) {
  const accepted: [string, string][] = [
    ['the attribute form', connected(BY_PROPS, '<FrameBase props={{ title: String(orders) }} children={props.children} />')],
    ['the nested props.children', connected(BY_PROPS, '<FrameBase props={{ title: String(orders) }}>{props.children}</FrameBase>')],
    ['the nested destructured children', connected(BY_DESTRUCTURE, '<FrameBase props={{ title: String(orders) }}>{children}</FrameBase>')],
  ];
  for (const [name, index] of accepted) {
    test(`${edition}: ${name} is a render path to the sibling Base`, (t) => {
      assert.deepEqual(judged(t, edition, index), { pair: 0, owner: 0 });
    });
  }

  const refused: [string, string][] = [
    ['control: a bare intrinsic', connected(BY_PROPS, '<i />')],
    ['arbitrary JSX beside the forwarded children', connected(BY_PROPS, '<FrameBase props={{ title: String(orders) }}><i />{props.children}</FrameBase>')],
    ['an intrinsic element as the only child', connected(BY_PROPS, '<FrameBase props={{ title: String(orders) }}><i /></FrameBase>')],
    ['another expression as the child', connected(BY_PROPS, '<FrameBase props={{ title: String(orders) }}>{orders}</FrameBase>')],
    ['a member of something that is no parameter', connected(BY_PROPS, '<FrameBase props={{ title: String(orders) }}>{orders.children}</FrameBase>')],
    ['a member other than children', connected(BY_PROPS, '<FrameBase props={{ title: String(orders) }}>{props.other}</FrameBase>')],
  ];
  for (const [name, index] of refused) {
    test(`${edition}: ${name} is not a render path`, (t) => {
      const result = judged(t, edition, index);
      assert.equal(result.pair, 1);
      assert.equal(result.owner, 1);
    });
  }
}
