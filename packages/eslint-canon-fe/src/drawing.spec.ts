/**
 * Twin tests for the drawing law.
 *
 *   node --test src/drawing.spec.ts
 *
 * The scope is the pure half of a split tier. The cases that matter sit just outside it: the
 * connected half and the recipe composite are SUPPOSED to read status flags, and a layout alone
 * may take the router's children.
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../fixtures/typed/tester.ts"
import {
  baseImportPair,
  basePropsAtom,
  noDataStatusShape,
  rules,
} from "./drawing.ts"

const tester = slotTester()

const BLOCK = at("apps/web/src/components/blocks/sales/HandoffBlock/component.tsx")
const BLOCK_INDEX = at("apps/web/src/components/blocks/sales/HandoffBlock/index.tsx")
const LAYOUT = at("apps/web/src/features/layouts/WorkspaceLayout/component.tsx")
const PAGE = at("apps/web/src/features/pages/OperatePage/component.tsx")
const OVERLAY = at("apps/web/src/features/overlays/sales/SendOverlay/component.tsx")
const FEATURE_PAGE = PAGE
const COMPOSITE = at("apps/web/src/components/composites/SlotView/index.tsx")
const BRANCH = at("apps/web/src/components/branches/BlockList/index.tsx")

test("every rule this law declares is exported under its published name", () => {
  for (const [name, rule] of Object.entries(rules)) {
    assert.equal(typeof rule.create, "function", name)
    assert.ok(rule.meta?.docs?.description, name)
  }
})

test("a pure half takes shape, atom props and on actions", () => {
  assert.doesNotThrow(() => {
  tester.run("base-props-atom", basePropsAtom, {
    valid: [
      {
        filename: BLOCK,
        code: `
          type HandoffBlockData = { readonly order: Slot<Order>; readonly labels: { readonly send: string }; readonly ids: ReadonlyArray<string> }
          type HandoffBlockActions = { readonly requestSend: (input: { fingerprint: string; revision: number }) => void; readonly retry: () => void }
          export type HandoffBlockBaseProps = { readonly shape: "prepared" | "sent"; readonly props: HandoffBlockData; readonly on: HandoffBlockActions }
          export const HandoffBlockBase = (props: HandoffBlockBaseProps) => <div />`,
      },
      {
        filename: LAYOUT,
        code: `
          export type WorkspaceLayoutBaseProps = { readonly shape: "sidebar"; readonly props: { readonly workspaceId: string }; readonly children: ReactNode }
          export const WorkspaceLayoutBase = (props: WorkspaceLayoutBaseProps) => <div>{props.children}</div>`,
      },
      {
        filename: COMPOSITE,
        code: "export const SlotView = (props: { children: (data: string) => ReactNode }) => <div />",
      },
      // a `component.tsx` that no split tier owns is not a pure half: a shared-package leaf and a folder named like a tier
      {
        filename: at("packages/nivo-ui/src/leaves/Badge/component.tsx"),
        code: "export type BadgeBaseProps = { readonly shape: \"a\"; readonly props: { readonly icon: ReactNode }; readonly on: {} }",
      },
      {
        filename: at("apps/web/src/modules/components/blocks/Card/component.tsx"),
        code: "export type CardBaseProps = { readonly shape: \"a\"; readonly props: { readonly icon: ReactNode }; readonly on: {} }",
      },
    ],
    invalid: [
      {
        filename: PAGE,
        code: "export const OperatePageBase = (props: { state: \"view\"; props: {}; on: {} }) => <div />",
        errors: [{ messageId: "renamed" }],
      },
      {
        filename: PAGE,
        code: `
          type OperatePageData = { readonly main: ReactNode }
          export const OperatePageBase = (props: { shape: "view"; props: OperatePageData; on: {} }) => <div />`,
        errors: [{ messageId: "tree" }],
      },
      {
        filename: OVERLAY,
        code: "export const SendOverlayBase = (props: { shape: \"form\"; props: {}; chat: ComponentType }) => <div />",
        errors: [{ messageId: "member" }],
      },
      {
        filename: BLOCK,
        code: "export const HandoffBlockBase = (props: { shape: \"prepared\"; props: { readonly onSend: () => void }; on: {} }) => <div />",
        errors: [{ messageId: "action" }],
      },
      {
        filename: BLOCK,
        code: "export const HandoffBlockBase = (props: { shape: \"prepared\"; props: {}; on: { readonly title: string } }) => <div />",
        errors: [{ messageId: "onData" }],
      },
      {
        filename: BLOCK,
        code: "export const HandoffBlockBase = (props: { shape: \"prepared\"; props: {}; on: {}; children: ReactNode }) => <div />",
        errors: [{ messageId: "member" }],
      },
      {
        filename: BLOCK,
        code: "export const HandoffBlockBase = (props: { shape: \"prepared\"; props: {}; on: { readonly render: (node: JSX.Element) => void } }) => <div />",
        errors: [{ messageId: "tree" }],
      },
    ],
  })

  })
})

test("feature composition receives block render callbacks while ordinary props stay data", () => {
  assert.doesNotThrow(() => {
  tester.run("base-props-atom-render", basePropsAtom, {
    valid: [
      {
        filename: PAGE,
        code: `
          type OperatePageData = { readonly ids: readonly string[]; readonly renderItem: (id: string) => ReactNode; readonly renderEmpty: () => JSX.Element | null | undefined }
          export const OperatePageBase = (props: { shape: "view"; props: OperatePageData; on: {} }) => <BlockList ids={props.props.ids} renderItem={props.props.renderItem} />`,
      },
      {
        filename: OVERLAY,
        code: `
          type SendOverlayData = { renderItem(id: string): React.ReactElement }
          export const SendOverlayBase = (props: { shape: "form"; props: SendOverlayData; on: {} }) => <BlockList renderItem={props.props.renderItem} />`,
      },
      {
        filename: LAYOUT,
        code: `
          type RenderedBlock = React.JSX.Element
          type RenderBlock = (id: string) => RenderedBlock
          type WorkspaceLayoutData = { readonly render: RenderBlock }
          export const WorkspaceLayoutBase = (props: { shape: "sidebar"; props: WorkspaceLayoutData; on: {} }) => <BlockList renderItem={props.props.render} />`,
      },
      {
        filename: BRANCH,
        code: "export const BlockList = (props: { ids: readonly string[]; renderItem: (id: string) => ReactNode }) => <>{props.ids.map(props.renderItem)}</>",
      },
    ],
    invalid: [
      {
        filename: PAGE,
        code: "export const OperatePageBase = (props: { shape: \"view\"; props: { renderItem: ReactNode }; on: {} }) => <div />",
        errors: [{ messageId: "tree" }],
      },
      {
        filename: PAGE,
        code: "export const OperatePageBase = (props: { shape: \"view\"; props: { renderItem: (node: React.ReactNode) => ReactNode }; on: {} }) => <div />",
        errors: [{ messageId: "tree" }],
      },
      {
        filename: PAGE,
        code: "export const OperatePageBase = (props: { shape: \"view\"; props: { getItem: (id: string) => ReactNode }; on: {} }) => <div />",
        errors: [{ messageId: "action" }],
      },
      {
        filename: PAGE,
        code: `
          type RenderItem = (id: string) => ReactNode
          export const OperatePageBase = (props: { shape: "view"; props: { renderItem: RenderItem; getItem: RenderItem }; on: {} }) => <div />`,
        errors: [{ messageId: "action" }],
      },
      {
        filename: PAGE,
        code: "export const OperatePageBase = (props: { shape: \"view\"; props: { renderItem: (id: string) => string }; on: {} }) => <div />",
        errors: [{ messageId: "action" }],
      },
      {
        filename: PAGE,
        code: "export const OperatePageBase = (props: { shape: \"view\"; props: { renderItem: (id: string) => ReactNode | boolean }; on: {} }) => <div />",
        errors: [{ messageId: "action" }],
      },
      {
        filename: PAGE,
        code: "export const OperatePageBase = (props: { shape: \"view\"; props: { nested: { renderItem: (id: string) => ReactNode } }; on: {} }) => <div />",
        errors: [{ messageId: "action" }],
      },
      {
        filename: PAGE,
        code: "export const OperatePageBase = (props: { shape: \"view\"; props: {}; renderItem: (id: string) => ReactNode; on: {} }) => <div />",
        errors: [{ messageId: "member" }],
      },
      {
        filename: PAGE,
        code: "export const OperatePageBase = (props: { shape: \"view\"; props: {}; children: ReactNode; on: {} }) => <div />",
        errors: [{ messageId: "member" }],
      },
      {
        filename: BLOCK,
        code: "export const HandoffBlockBase = (props: { shape: \"prepared\"; props: { renderItem: (id: string) => ReactNode }; on: {} }) => <div />",
        errors: [{ messageId: "action" }],
      },
    ],
  })

  })
})

test("only the sibling index reaches the pure half, and it never re-exports XBase", () => {
  assert.doesNotThrow(() => {
  tester.run("base-import-pair", baseImportPair, {
    valid: [
      { filename: BLOCK_INDEX, code: "import { HandoffBlockBase } from \"./component\"" },
      { filename: BLOCK_INDEX, code: "export type { HandoffBlockShape } from \"./component\"" },
      { filename: PAGE, code: "import { HandoffBlock } from \"@/components/blocks/sales/HandoffBlock\"" },
      // a sibling `./component` outside a split tier is an ordinary module
      { filename: at("apps/web/src/modules/utils/index.ts"), code: "import { x } from \"./component\"" },
      { filename: at("apps/web/src/modules/components/blocks/Card/index.tsx"), code: "import { CardBase } from \"./component\"; export { CardBase }" },
    ],
    invalid: [
      { filename: PAGE, code: "import { HandoffBlockBase } from \"@/components/blocks/sales/HandoffBlock/component\"", errors: [{ messageId: "reach" }] },
      { filename: LAYOUT, code: "import { X } from \"../../../components/blocks/Y/component\"", errors: [{ messageId: "reach" }] },
      { filename: BLOCK_INDEX, code: "export { HandoffBlockBase } from \"./component\"", errors: [{ messageId: "reexport" }] },
    ],
  })

  })
})

test("a shape union never lists a data status or open/closed", () => {
  assert.doesNotThrow(() => {
  tester.run("no-data-status-shape", noDataStatusShape, {
    valid: [
      { filename: BLOCK, code: "export type HandoffBlockShape = \"prepared\" | \"sent\" | \"returned\"" },
      { filename: OVERLAY, code: "export type SendOverlayShape = \"form\" | \"confirm\"" },
      { filename: BLOCK_INDEX, code: "export type HandoffBlockShape = \"pending\" | \"ready\"" },
      // a `component.tsx` outside every split tier names no drawn shapes
      { filename: at("packages/nivo-ui/src/leaves/Badge/component.tsx"), code: "export type BadgeShape = \"pending\" | \"ready\"" },
      { filename: at("apps/web/src/modules/components/blocks/Card/component.tsx"), code: "export type CardShape = \"pending\"" },
    ],
    invalid: [
      { filename: BLOCK, code: "export type ExampleBlockShape = \"pending\" | \"ready\" | \"failed\"", errors: [{ messageId: "status" }, { messageId: "status" }] },
      { filename: OVERLAY, code: "export type DrawerShape = \"closed\" | \"ready\"", errors: [{ messageId: "status" }] },
      { filename: FEATURE_PAGE, code: "export type OperatePageShape = \"view\" | \"loading\"", errors: [{ messageId: "status" }] },
    ],
  })

  })
})

test("the pure half's input is `shape`: the old `state` key is refused and renamed by the fix", () => {
  assert.doesNotThrow(() => {
    tester.run("base-props-atom-shape", basePropsAtom, {
      valid: [
        { filename: BLOCK, code: "export const HandoffBlockBase = (props: { shape?: HandoffBlockShape; props: { readonly id: string }; on?: { readonly retry: () => void } }) => <div />" },
        { filename: BLOCK, code: "export const HandoffBlockBase = (props: { props: { readonly id: string } }) => <div />" },
      ],
      invalid: [
        {
          filename: BLOCK,
          code: "export const HandoffBlockBase = (props: { state: HandoffBlockShape; props: {}; on: {} }) => <div />",
          output: "export const HandoffBlockBase = (props: { shape: HandoffBlockShape; props: {}; on: {} }) => <div />",
          errors: [{ messageId: "renamed" }],
        },
        {
          filename: BLOCK,
          code: "type HandoffBlockBaseProps = { readonly state?: \"sent\"; readonly props: {} }\nexport const HandoffBlockBase = (props: HandoffBlockBaseProps) => <div />",
          output: "type HandoffBlockBaseProps = { readonly shape?: \"sent\"; readonly props: {} }\nexport const HandoffBlockBase = (props: HandoffBlockBaseProps) => <div />",
          errors: [{ messageId: "renamed" }],
        },
      ],
    })
  })
})

test("a shape is never a status, written as an interface, an inline object or a flag", () => {
  assert.doesNotThrow(() => {
    tester.run("no-data-status-shape-forms", noDataStatusShape, {
      valid: [
        { filename: BLOCK, code: "export interface HandoffBlockShape { readonly layout: \"wide\" | \"narrow\" }" },
        { filename: BLOCK, code: "export const HandoffBlockBase = (props: { shape: \"form\" | \"confirm\"; props: { readonly isOpen: boolean } }) => <div />" },
        { filename: BLOCK, code: "export const HandoffBlockBase = (props: { shape: HandoffBlockShape; props: {} }) => <div />" },
        // the connected half may hold status: only the pure half draws shapes
        { filename: BLOCK_INDEX, code: "export interface HandoffBlockShape { readonly isLoading: boolean }" },
      ],
      invalid: [
        { filename: BLOCK, code: "export interface HandoffBlockShape { readonly isRenewing: boolean }", errors: [{ messageId: "flag" }] },
        { filename: BLOCK, code: "export interface HandoffBlockShape { readonly phase: \"ready\" | \"loading\" }", errors: [{ messageId: "status" }] },
        { filename: BLOCK, code: "export type PayDrawerShape = { readonly step: \"pay\" | \"done\"; readonly isOpen: boolean }", errors: [{ messageId: "flag" }] },
        { filename: BLOCK, code: "export type HandoffBlockShape = \"sent\" | { readonly expanded: boolean }", errors: [{ messageId: "flag" }] },
        {
          filename: BLOCK,
          code: "export const BillingOverviewBase = (props: { shape: { readonly isRenewing: boolean }; props: {} }) => <div />",
          errors: [{ messageId: "flag" }],
        },
        { filename: OVERLAY, code: "export const SendOverlayBase = (props: { shape: \"form\" | \"closed\"; props: {} }) => <div />", errors: [{ messageId: "status" }] },
      ],
    })
  })
})
