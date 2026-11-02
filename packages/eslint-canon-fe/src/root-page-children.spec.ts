/** The documented one-level RootPage composition is a structural exception, never a block name. */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import test, { type TestContext } from "node:test"
import { Linter } from "eslint"
import parser from "@typescript-eslint/parser"
import { projectFixture, type ProjectFixture } from "../../eslint-canon-be/fixtures/project/tester.ts"
import { loadHfs } from "./lib/hfs.ts"
import { eslintRule } from "./lib/eslint-boundary.ts"
import { basePropsAtom } from "./drawing.ts"
import { tierChildren } from "./props-and-slots.ts"

const BLOCK = "apps/web/src/components/blocks/Root"
const SOURCE = "apps/web/src"
interface Variation {
  readonly family?: string
  readonly segment?: boolean
  readonly roleImport?: string
  readonly drawing?: string
  readonly compose?: string
  readonly connected?: string
  readonly mounted?: boolean
  readonly extra?: string
  readonly shape?: string
  readonly otherInput?: boolean
  readonly status?: boolean
  readonly statusSource?: string
  readonly statusRender?: string
  readonly statusRetarget?: boolean
  readonly helper?: string
}

const STATUS_RECIPE = `export const SlotView = (props) => {
  const { slot } = props;
  if ("isLoading" in slot) return <>{props.render(props.placeholder, true)}</>;
  if ("isForbidden" in slot) return null;
  if ("isError" in slot) return <div>Error</div>;
  if ("isEmpty" in slot) return null;
  return <>{props.render(slot.items, false)}</>;
};`

const fixture = (t: TestContext, edition: "lite" | "full", variation: Variation = {}): ProjectFixture => {
  const kind = variation.segment ? "layouts" : "pages"
  const files = {
    [`${BLOCK}/index.tsx`]: `"use client";
      import type { ReactNode } from "react";
      import { RootBase as Draw } from "./component";
      interface RootProps { readonly children: ReactNode }
      ${variation.otherInput ? "interface UnrelatedProps { readonly children: ReactNode }" : ""}
      export const Root = (props: RootProps) => ${variation.connected ?? '<Draw props={{ title: "Title" }} children={props.children} />'};`,
    [`${BLOCK}/component.tsx`]: `import type { ReactNode } from "react";
      ${variation.roleImport ?? 'import { Page as Canvas, PaneGrid as Areas, Pane as Cell } from "@starci/grammar/common";'}
      ${
        variation.status
          ? `import { SlotView as Region } from "@/components/composites/SlotView";
        interface BodyProps { readonly body: ReactNode }
        const Body = (props: BodyProps) => <Region slot={read} placeholder={false} render={() => ${variation.statusRender ?? "props.body"}} />;`
          : ""
      }
      ${variation.helper ?? ""}
      export interface RootBaseProps { readonly children: ReactNode; readonly props: { readonly title: string; ${variation.extra ?? ""} }; ${variation.shape ?? ""} }
      export const RootBase = (props: RootBaseProps) => ${variation.drawing ?? `<Canvas header={{ title: props.props.title${variation.segment ? ', tabs: { label: "Tabs", items: [{ id: "one", label: "One", href: "/one" }] }' : ""} }}>${variation.status ? '<Areas areas={["body"]}><Cell area="body"><Body body={props.children} /></Cell></Areas>' : "{props.children}"}</Canvas>`};`,
    ...(variation.status
      ? {
          [`${SOURCE}/components/composites/SlotView/index.tsx`]: variation.statusRetarget
            ? 'export { Equivalent as SlotView } from "@/components/frames/Equivalent";'
            : (variation.statusSource ?? STATUS_RECIPE),
          ...(variation.statusRetarget
            ? { [`${SOURCE}/components/frames/Equivalent/index.tsx`]: STATUS_RECIPE.replace("SlotView", "Equivalent") }
            : {})
        }
      : {}),
    [`${SOURCE}/features/${kind}/Screen/index.tsx`]:
      'import { ScreenBase as Pure } from "./component"; export const Screen = () => <Pure props={{}} />;',
    [`${SOURCE}/features/${kind}/Screen/component.tsx`]: `import { Root as Connected } from "@/components/blocks/Root"; export const ScreenBase = () => ${variation.compose ?? "<Connected><article>Body</article></Connected>"};`,
    ...(variation.mounted === false
      ? {}
      : {
          [`${SOURCE}/app/${variation.segment ? "layout" : "page"}.tsx`]: `import { Screen as Owner } from "@/features/${kind}/Screen"; const Route = () => <Owner />; export default Route;`
        })
  }
  const app = projectFixture({ profile: "fe", edition, declaration: { grammar: variation.family ?? "core" }, files })
  t.after(app.cleanup)
  return app
}

const verify = (app: ProjectFixture, file: string, unsavedSource?: string): readonly Linter.LintMessage[] =>
  new Linter({ cwd: app.root }).verify(
    unsavedSource ?? fs.readFileSync(app.at(file), "utf8"),
    [
      {
        files: ["**/*.tsx"],
        languageOptions: { parser, sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } },
        settings: { starci: { hfs: loadHfs(pathToFileURL(path.join(app.root, "eslint.config.mjs"))) } },
        plugins: { canon: { rules: { children: eslintRule(tierChildren), atoms: eslintRule(basePropsAtom) } } },
        rules: { "canon/children": "error", "canon/atoms": "error" }
      }
    ],
    { filename: app.at(file) }
  )

const ids = (app: ProjectFixture, file: "index.tsx" | "component.tsx"): readonly (string | undefined)[] =>
  verify(app, `${BLOCK}/${file}`).map((finding) => finding.messageId)

for (const edition of ["lite", "full"] as const) {
  test(`${edition}: virtual entry and drawing files refuse children without reading nonexistent source`, (t) => {
    const app = fixture(t, edition)
    const entry = `${SOURCE}/components/blocks/Virtual/index.tsx`
    const drawing = `${SOURCE}/components/blocks/Virtual/component.tsx`
    assert.equal(fs.existsSync(app.at(entry)), false)
    assert.equal(fs.existsSync(app.at(drawing)), false)
    const entryFindings = verify(
      app,
      entry,
      "interface VirtualProps { readonly children: ReactNode }; export const Virtual = (props: VirtualProps) => <section />;"
    )
    assert.deepEqual(
      entryFindings.map((finding) => finding.messageId),
      ["none"]
    )
    const drawingFindings = verify(
      app,
      drawing,
      "interface VirtualBaseProps { readonly children: ReactNode; readonly props: {} }; export const VirtualBase = (props: VirtualBaseProps) => <section />;"
    )
    assert.deepEqual(
      drawingFindings.map((finding) => finding.messageId),
      ["none", "member"]
    )
  })

  test(`${edition}: unsaved source cannot borrow a mounted file's on-disk RootPage proof`, (t) => {
    const app = fixture(t, edition)
    for (const name of ["index.tsx", "component.tsx"]) {
      const file = `${BLOCK}/${name}`
      const unsaved = `${fs.readFileSync(app.at(file), "utf8")}\n// Unsaved editor contents.\n`
      const findings = verify(app, file, unsaved)
      assert.ok(findings.some((finding) => finding.messageId === "none"))
      if (name === "component.tsx") assert.ok(findings.some((finding) => finding.messageId === "member"))
      assert.ok(findings.every((finding) => !finding.fatal))
    }
  })

  for (const family of ["core", "offset-pop"]) {
    for (const segment of [false, true])
      test(`${edition}/${family}: mounted ${segment ? "segment" : "page"} owns children through aliased connected/root Base`, (t) => {
        const app = fixture(t, edition, { family, segment })
        assert.deepEqual(ids(app, "index.tsx"), [])
        assert.deepEqual(ids(app, "component.tsx"), [])
      })
  }

  const negatives: Readonly<Record<string, Variation>> = {
    ordinary: { drawing: "<section>{props.children}</section>" },
    nested: { drawing: "<section><Canvas>{props.children}</Canvas></section>" },
    sibling: { compose: "<><Connected /><aside>Outside</aside></>" },
    nonroot: { compose: "<section><Connected /></section>" },
    relayed: { drawing: "<Relay>{props.children}</Relay>" },
    fake: { roleImport: "const Canvas = (props: { readonly children: ReactNode }) => <main>{props.children}</main>;" },
    foreign: { roleImport: 'import { Page as Canvas } from "foreign-design";' },
    wrongFamily: { family: "offset-pop", roleImport: 'import { Page as Canvas } from "@starci/grammar/core";' },
    unusedPage: { drawing: "(() => { const unused = <Canvas />; return <section>{props.children}</section>; })()" },
    falseBody: { drawing: "<Canvas>{false && props.children}</Canvas>" },
    conditionalBody: { drawing: "<Canvas>{false ? props.children : null}</Canvas>" },
    callbackBody: { drawing: "<Canvas>{() => props.children}</Canvas>" },
    attributeBody: { drawing: "<Canvas><div data-node={props.children} /></Canvas>" },
    duplicatedBody: { drawing: "<Canvas>{props.children}{props.children}</Canvas>" },
    unreachablePage: { drawing: "{ if (false) return <Canvas>{props.children}</Canvas>; return null; }" },
    immutableFalseAlias: { drawing: "{ const dead = false; if (dead) return <Canvas>{props.children}</Canvas>; return null; }" },
    immutableNegatedTrue: {
      drawing: "{ const live = true; const alias = live; if (!alias) return <Canvas>{props.children}</Canvas>; return null; }"
    },
    afterReturn: { drawing: "{ return null; return <Canvas>{props.children}</Canvas>; }" },
    unusedOwner: { mounted: false },
    discardedChildren: { connected: '<Draw props={{ title: "Title" }} children={other.children} />' },
    untabbedSegment: { segment: true, drawing: "<Canvas header={{ title: props.props.title }}>{props.children}</Canvas>" },
    unknownRole: { family: "core", roleImport: 'import { Unknown as Canvas } from "@starci/grammar/common";' }
  }
  for (const [name, variation] of Object.entries(negatives))
    test(`${edition}: ${name} grants no RootPage children door`, (t) => {
      const app = fixture(t, edition, variation)
      assert.ok(ids(app, "index.tsx").includes("none"))
      assert.ok(ids(app, "component.tsx").includes("member"))
    })

  test(`${edition}: actual immutable true aliases keep the reachable Page arm`, (t) => {
    const app = fixture(t, edition, {
      drawing: "{ const live = true; const alias = live; if (alias) return <Canvas>{props.children}</Canvas>; return null; }"
    })
    assert.deepEqual(ids(app, "index.tsx"), [])
    assert.deepEqual(ids(app, "component.tsx"), [])
  })

  test(`${edition}: canonical Page/PaneGrid/Pane and actual local region preserve loading, refusal and ready provenance`, (t) => {
    const app = fixture(t, edition, { segment: true, status: true })
    assert.deepEqual(ids(app, "index.tsx"), [])
    assert.deepEqual(ids(app, "component.tsx"), [])
  })

  const nativeImports = 'import { Page as Canvas, PaneGrid as Areas, Pane as Cell, Stack as Flow, PaneSection as Band, Section as Group } from "@starci/grammar/common";'
  for (const family of ["core", "offset-pop"]) {
    for (const as of ["", ' as="div"', ' as="header"', ' as="footer"'])
      test(`${edition}/${family}: the selected native Stack${as || " default"} preserves the Page body`, (t) => {
        const app = fixture(t, edition, { family, roleImport: nativeImports, drawing: `<Canvas><Flow gap="region"${as}>{props.children}</Flow></Canvas>` })
        assert.deepEqual(ids(app, "index.tsx"), [])
        assert.deepEqual(ids(app, "component.tsx"), [])
      })
    for (const kind of ["", ' kind="region"'])
      test(`${edition}/${family}: real Pane context survives local Detail into native Section${kind || " default"}`, (t) => {
        const app = fixture(t, edition, {
          family, roleImport: nativeImports,
          helper: `const Detail = (props) => <Group title="Detail"${kind}><Flow gap="row">{props.findings}</Flow></Group>;`,
          drawing: '<Canvas><Areas areas={["detail"]}><Cell area="detail"><Band gap="section"><Detail findings={props.children} /></Band></Cell></Areas></Canvas>'
        })
        assert.deepEqual(ids(app, "index.tsx"), [])
        assert.deepEqual(ids(app, "component.tsx"), [])
      })
    test(`${edition}/${family}: a finite local body helper retains the canonical ancestor context`, (t) => {
      const app = fixture(t, edition, {
        family, roleImport: nativeImports,
        helper: 'const Detail = (props) => <Band><Flow gap="row">{props.findings}</Flow></Band>;',
        drawing: '<Canvas><Areas areas={["detail"]}><Cell area="detail"><Detail findings={props.children} /></Cell></Areas></Canvas>'
      })
      assert.deepEqual(ids(app, "index.tsx"), [])
      assert.deepEqual(ids(app, "component.tsx"), [])
    })
  }

  const body = (child: string): string => `<Canvas><Areas areas={["detail"]}><Cell area="detail">${child}</Cell></Areas></Canvas>`
  for (const [name, variation] of Object.entries({
    noPane: { drawing: '<Canvas><Band>{props.children}</Band></Canvas>' },
    customStackAs: { drawing: '<Canvas><Flow as={Custom}>{props.children}</Flow></Canvas>' },
    unknownStackAs: { drawing: '<Canvas><Flow as="img">{props.children}</Flow></Canvas>' },
    duplicateStackAs: { drawing: '<Canvas><Flow as="div" as={Custom}>{props.children}</Flow></Canvas>' },
    foreignStack: { roleImport: `${nativeImports.replace("Stack as Flow, ", "")} import { Stack as Flow } from "foreign-design";`, drawing: '<Canvas><Flow>{props.children}</Flow></Canvas>' },
    foreignPane: { roleImport: `${nativeImports.replace("Pane as Cell, ", "")} import { Pane as Cell } from "foreign-design";`, drawing: body('<Band>{props.children}</Band>') },
    foreignPaneSection: { roleImport: `${nativeImports.replace("PaneSection as Band, ", "")} import { PaneSection as Band } from "foreign-design";`, drawing: body('<Band>{props.children}</Band>') },
    shadowedPane: { drawing: `{ const Cell = (props) => <div>{props.children}</div>; return ${body('<Band>{props.children}</Band>')}; }` },
    spreadPane: { drawing: '<Canvas><Areas areas={["detail"]}><Cell area="detail" {...view}><Band>{props.children}</Band></Cell></Areas></Canvas>' },
    siblingContext: { drawing: '<Canvas><Cell area="other" /><Band>{props.children}</Band></Canvas>' },
    paneError: { drawing: body('<Band error={{ message: "failed" }}>{props.children}</Band>') },
    dynamicPaneError: { drawing: body('<Band error={error}>{props.children}</Band>') },
    undefinedPaneError: { drawing: body('<Band error={undefined}>{props.children}</Band>') },
    paneSpread: { drawing: body('<Band {...view}>{props.children}</Band>') },
    customPaneSectionAs: { drawing: body('<Band as={Custom}>{props.children}</Band>') },
    listSection: { drawing: body('<Band><Group kind="list">{props.children}</Group></Band>') },
    figuresSection: { drawing: body('<Band><Group kind="figures">{props.children}</Group></Band>') },
    dynamicSection: { drawing: body('<Band><Group kind={kind}>{props.children}</Group></Band>') },
    unknownSection: { drawing: body('<Band><Group kind="unknown">{props.children}</Group></Band>') },
    sectionError: { drawing: body('<Band><Group error={error}>{props.children}</Group></Band>') },
    undefinedSectionError: { drawing: body('<Band><Group error={undefined}>{props.children}</Group></Band>') },
    sectionSpread: { drawing: body('<Band><Group {...view}>{props.children}</Group></Band>') },
    foreignSection: { roleImport: `${nativeImports.replace(", Section as Group", "")} import { Section as Group } from "foreign-design";`, drawing: body('<Band><Group>{props.children}</Group></Band>') },
    duplicatedLayout: { drawing: body('<Band><Flow>{props.children}{props.children}</Flow></Band>') },
    droppedLayout: { drawing: '<Canvas><Flow gap="region" /></Canvas>' },
    hiddenRefusal: { helper: 'const Detail = (props) => <Group>{false ? props.findings : null}</Group>;', drawing: body('<Band><Detail findings={props.children} /></Band>') }
  } satisfies Record<string, Variation>))
    test(`${edition}: native body capability refuses ${name}`, (t) => {
      const app = fixture(t, edition, { roleImport: nativeImports, ...variation })
      assert.ok(ids(app, "index.tsx").includes("none"))
      assert.ok(ids(app, "component.tsx").includes("member"))
    })

  test(`${edition}: a selected export alias within the real canonical region entry keeps its owner proof`, (t) => {
    const app = fixture(t, edition, {
      status: true,
      statusSource: `${STATUS_RECIPE.replace("export const SlotView", "const Actual")}\nexport { Actual as SlotView };`
    })
    assert.deepEqual(ids(app, "index.tsx"), [])
    assert.deepEqual(ids(app, "component.tsx"), [])
  })

  for (const [name, variation] of Object.entries({
    deadRegionCallback: { status: true, statusRender: "false && props.body" },
    duplicateRegionCallback: { status: true, statusRender: "<>{props.body}{props.body}</>" },
    fakeRegionOwner: { status: true, statusSource: "export const SlotView = () => null;" },
    canonicalBarrelWrongTier: { status: true, statusRetarget: true },
    deadRegionReady: {
      status: true,
      statusSource:
        "export const SlotView = (props) => { return null; if (false) return <>{props.render(props.placeholder,true)}</>; return <>{props.render(props.slot.items,false)}</>; };"
    }
  } satisfies Record<string, Variation>))
    test(`${edition}: ${name} is not a proven status recipe`, (t) => {
      const app = fixture(t, edition, variation)
      assert.ok(ids(app, "index.tsx").includes("none"))
      assert.ok(ids(app, "component.tsx").includes("member"))
    })

  test(`${edition}: proven children does not legalize another node prop, a shape node record, or an unrelated input`, (t) => {
    const app = fixture(t, edition, { extra: "readonly extra: ReactNode", shape: "readonly shape: { readonly body: ReactNode }", otherInput: true })
    assert.deepEqual(ids(app, "index.tsx"), ["none"])
    const findings = verify(app, `${BLOCK}/component.tsx`)
    assert.deepEqual(
      findings.map((finding) => finding.messageId),
      ["tree", "tree"]
    )
    assert.ok(findings.some((finding) => finding.message.includes("props.extra")))
    assert.ok(findings.some((finding) => finding.message.includes("shape.body")))
  })
}
