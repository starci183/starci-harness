import test, { type TestContext } from "node:test"
import { projectFixture } from "../../eslint-canon-be/fixtures/project/tester.ts"
import { rules } from "./project-graph.ts"
import { canonTester } from "../fixtures/typed/tester.ts"
import type { Rule } from "./lib/rule.ts"

/** The rule project-graph publishes as `name`; a missing one fails the run. */
const ruleOf = (name: string): Rule => {
  const rule = rules[name]
  if (rule === undefined) throw new Error(`project-graph publishes no ${name}`)
  return rule
}
import { rules as boundaryRules } from "./client-boundary.ts"
import { rules as drawingRules } from "./drawing.ts"
import { rules as propsRules } from "./props-and-slots.ts"
import { rules as splitRules } from "./the-split.ts"
import { rules as loadingRules } from "./loading.ts"
import { navigationFromIntl, noNullSuspenseFallback } from "./next-conventions.ts"
import { overlayHostFiles } from "../fixtures/overlay-host-files.ts"

const overlay = "apps/web/src/features/overlays/ItemsOverlay/index.tsx"
const block = "apps/web/src/components/blocks/ItemBlock/index.tsx"
const branch = "apps/web/src/components/branches/ItemList/index.tsx"
const files: Readonly<Record<string, string>> = {
    "apps/web/src/app/page.tsx": 'import { ItemsPage } from "../features/pages/ItemsPage"\nexport default function Route() { return <ItemsPage /> }\n',
    "apps/web/src/features/pages/ItemsPage/index.tsx": 'import { ItemsOverlay } from "../../overlays/ItemsOverlay"\nexport const ItemsPage = () => <ItemsOverlay />\n',
    [branch]: 'export const ItemList = (props: { ids: string[], renderItem: (id: string) => unknown }) => <section>{props.ids.map(props.renderItem)}</section>\n',
    "apps/web/src/features/overlays/ItemsOverlay/component.tsx": 'import { ItemList } from "../../../components/branches/ItemList"\nexport const ItemsOverlayBase = (props: { props: { ids: string[], renderItem: (id: string) => unknown } }) => <ItemList {...props.props} />\n',
    [block]: 'import { useItems } from "../../../hooks/swr"\nimport { ItemBlockBase } from "./component"\nexport const ItemBlock = (props: { id: string }) => { const ids = useItems(); return <ItemBlockBase id={props.id} count={ids.length} /> }\n',
    "apps/web/src/components/blocks/ItemBlock/component.tsx": 'export const ItemBlockBase = (props: { id: string, count: number }) => <article>{props.id}{props.count}</article>\n',
    "apps/web/src/hooks/swr/index.ts": 'export const useItems = () => ["one", "two"]\n',
}

/** The text of one scene file. */
const codeOf = (rel: string): string => {
    const code = files[rel]
    if (code === undefined) throw new Error(`no scene file ${rel}`)
    return code
}

const composition = (body: string) => [
    '"use client"',
    'import { createElement } from "react"',
    'import { useItems } from "../../../hooks/swr"',
    'import { ItemBlock } from "../../../components/blocks/ItemBlock"',
    'import { ItemsOverlayBase } from "./component"',
    'import { ItemList } from "../../../components/branches/ItemList"',
    `export const ItemsOverlay = () => { const ids = useItems(); ${body} }`,
    "",
].join("\n")

const checkScene = (t: TestContext, code: string) => {
    const f = projectFixture({ profile: "fe", files: { ...files, [overlay]: code } })
    t.after(f.cleanup)
    const at = (rel: string) => ({ filename: f.at(rel), code: rel === overlay ? code : codeOf(rel) })
    return { ...f, at }
}

test("composition: a page mounts a client overlay whose pure view and branch render supplied connected blocks", (t) => {
    const s = checkScene(t, composition('return <ItemsOverlayBase props={{ ids, renderItem: (id) => <ItemBlock id={id + ids[0]} /> }} />;'))
    for (const id of ["tier-direction", "component-purity", "route-adapter"]) {
        canonTester(s.tester).run(id, ruleOf(id), { valid: Object.keys({ ...files, [overlay]: "" }).map(s.at), invalid: [] })
    }
})

test("composition: captured callbacks, aliases, mapped lists and React element construction keep the pure boundary", (t) => {
    const bodies = [
        'return <ItemList ids={ids} renderItem={() => <ItemBlock id={ids[0]} />} />;',
        'const renderItem = () => <ItemBlock id={ids[0]} />; return <ItemList ids={ids} renderItem={renderItem} />;',
        'return <ItemList ids={ids} content={ids.map(id => <ItemBlock key={id} id={id} />)} />;',
        'const content = [<ItemBlock id={ids[0]} />]; return <ItemList ids={ids} content={content} />;',
        'return <ItemList ids={ids} renderItem={() => ids.map(id => <ItemBlock key={id} id={id} />)} />;',
        'return <ItemList ids={ids} renderItem={() => <>{ids.length ? <ItemBlock id={ids[0]} /> : null}</>} />;',
        'return createElement(ItemList, { ids, renderItem: () => createElement(ItemBlock, { id: ids[0] }) });',
    ]
    for (const body of bodies) {
        const s = checkScene(t, composition(body))
        canonTester(s.tester).run("component-purity", ruleOf("component-purity"), { valid: [s.at(overlay), s.at(branch), s.at(block)], invalid: [] })
    }
})

test("composition: inline drawing, dynamic targets, callback world reads and direct connected render paths stay forbidden", (t) => {
    const bodies = [
        'return <ItemList ids={ids} renderItem={() => <div>{ids[0]}</div>} />;',
        'return <ItemsOverlayBase props={{ ids, renderItem: () => <div>{ids[0]}</div> }} />;',
        'const choices = { item: ItemBlock }; const Target = choices[ids[0]]; return <ItemList ids={ids} renderItem={() => <Target id={ids[0]} />} />;',
        'return <ItemList ids={ids} renderItem={() => { const values = useItems(); return <ItemBlock id={values[0]} />; }} />;',
        'return <ItemBlock id={ids[0]} />;',
        'return <ItemList ids={ids} renderItem={ItemBlock} />;',
        'return <ItemList ids={ids} content={[<div>{ids[0]}</div>]} />;',
    ]
    for (const body of bodies) {
        const s = checkScene(t, composition(body))
        const errors = body.includes("const values") ? [{ messageId: "finding", line: 7 }, { messageId: "finding", line: 7 }]
            : [{ messageId: "finding", line: 7 }]
        canonTester(s.tester).run("component-purity", ruleOf("component-purity"), { valid: [s.at(branch), s.at(block)], invalid: [{ ...s.at(overlay), errors }] })
    }
})

test("composition: receiving block render props never permits a branch to import blocks or own their data", (t) => {
    const code = composition('return <ItemsOverlayBase props={{ ids, renderItem: (id) => <ItemBlock id={id} /> }} />;')
    const badBranch = 'import { ItemBlock } from "../../blocks/ItemBlock"\nimport { useItems } from "../../../hooks/swr"\nexport const ItemList = () => { const ids = useItems(); return ids.map(id => <ItemBlock id={id} />); }\n'
    const f = projectFixture({ profile: "fe", files: { ...files, [overlay]: code, [branch]: badBranch } })
    t.after(f.cleanup)
    const entry = { filename: f.at(branch), code: badBranch }
    canonTester(f.tester).run("tier-direction", ruleOf("tier-direction"), { valid: [], invalid: [{ ...entry, errors: [{ messageId: "finding", line: 1 }] }] })
    canonTester(f.tester).run("component-purity", ruleOf("component-purity"), { valid: [], invalid: [{ ...entry, errors: [{ messageId: "finding", line: 3 }, { messageId: "finding", line: 3 }] }] })
})

test("composition: a server layout passes rendered overlays to a client host owner and its pure branch", (t) => {
    const f = projectFixture({ profile: "fe", files: overlayHostFiles })
    t.after(f.cleanup)
    const valid = Object.entries(overlayHostFiles).map(([rel, code]) => ({ filename: f.at(rel), code }))
    const graphIds = ["tier-direction", "owner-export-bypass", "component-purity", "route-adapter", "client-reaches-server", "hook-location"]
    for (const id of graphIds) canonTester(f.tester).run(id, ruleOf(id), { valid, invalid: [] })
    for (const family of [boundaryRules, drawingRules, propsRules, splitRules, loadingRules]) {
        // These rules read syntax/slots; the same scene supplies actual imports for the graph checks above.
        for (const [id, rule] of Object.entries(family)) {
            if (id === "server-module-marks-server-only" || id === "response-cookie-attributes") continue
            canonTester(f.tester).run(id, rule, { valid, invalid: [] })
        }
    }
    canonTester(f.tester).run("navigation-from-intl", navigationFromIntl, { valid, invalid: [] })
    canonTester(f.tester).run("no-null-suspense-fallback", noNullSuspenseFallback, { valid, invalid: [] })
})

test("composition: layout overlay hosting does not let its pure branch import or select product-world owners", (t) => {
    const branch = "apps/web/src/components/branches/OverlayHost/index.tsx"
    const code = 'import { Confirm } from "../../../features/overlays/Confirm"\nimport { useOverlayRouteState } from "../../../hooks/overlays"\nexport const OverlayHost = () => { const selected = useOverlayRouteState(); return selected && <Confirm />; }\n'
    const f = projectFixture({ profile: "fe", files: { ...overlayHostFiles, [branch]: code } })
    t.after(f.cleanup)
    const entry = { filename: f.at(branch), code }
    canonTester(f.tester).run("tier-direction", ruleOf("tier-direction"), { valid: [], invalid: [{ ...entry, errors: [{ messageId: "finding", line: 1 }] }] })
    canonTester(f.tester).run("component-purity", ruleOf("component-purity"), { valid: [], invalid: [{ ...entry, errors: [{ messageId: "finding", line: 3 }] }] })
})
