/**
 * Twin tests for the card laws: R355 (a body card holds no hand list, Divider or second title; a custom zone holds no Tabs, SearchField or Divider) and R366 (a labelled
 * card is not repeated in a card grid).
 *
 *   node --test src/surface-card.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { noLabelInGrid, recommended, rules, surfaceCardKind } from "./surface-card.ts"

const BLOCK = at("apps/web/src/components/blocks/Runs/component.tsx")
const SCRIPT = at("scripts/render.tsx")
const IMPORTS = "import { SurfaceCard, Section, Grid, Divider, SectionHeader, Heading, Text, Tabs, SearchField } from \"@starci/grammar/core\"\n"

test("the law publishes two rules and both are errors", () => {
  assert.deepEqual(Object.keys(rules), ["surface-card-kind", "no-label-in-grid"])
  assert.deepEqual(recommended, {
    "starci-grammar/surface-card-kind": "error",
    "starci-grammar/no-label-in-grid": "error",
  })
})

test("R355: a body card holds no hand list, no Divider, no second title", () => {
  slotTester().run("surface-card-kind", surfaceCardKind, {
    valid: [
      { filename: BLOCK, code: IMPORTS + "export const A = () => <SurfaceCard label=\"Run\"><Text>One line.</Text></SurfaceCard>" },
      // a list is a kind
      { filename: BLOCK, code: IMPORTS + "export const A = () => <SurfaceCard kind=\"list\" label=\"Run\" items={[]} empty={null} />" },
      // a hand list or heading deeper inside is judged where it is not a direct child
      { filename: BLOCK, code: IMPORTS + "export const A = () => <SurfaceCard label=\"Run\"><div><ul><li>x</li></ul></div></SurfaceCard>" },
      // another source's card
      { filename: BLOCK, code: "import { SurfaceCard } from \"other-kit\"\nexport const A = () => <SurfaceCard><ul><li>x</li></ul></SurfaceCard>" },
      { filename: SCRIPT, code: IMPORTS + "export const A = () => <SurfaceCard label=\"Run\"><ul><li>x</li></ul></SurfaceCard>" },
      // a custom zone holding copy is fine; the typed zones carry the search
      { filename: BLOCK, code: IMPORTS + "export const A = () => <SurfaceCard kind=\"list\" label=\"Run\" items={[]} empty={null} headers={[{ kind: \"custom\", children: <Text>Note</Text> }, { kind: \"search\", label: \"Find\", value: \"\", onChange }]} />" },
    ],
    invalid: [
      { filename: BLOCK, code: IMPORTS + "export const A = () => <SurfaceCard label=\"Run\"><ul><li>x</li></ul></SurfaceCard>", errors: [{ messageId: "list" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <SurfaceCard label=\"Run\" kind=\"body\"><ol>{rows.map((r) => <li key={r}>{r}</li>)}</ol></SurfaceCard>", errors: [{ messageId: "list" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <SurfaceCard label=\"Run\"><Text>a</Text><Divider /><Text>b</Text></SurfaceCard>", errors: [{ messageId: "divider" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <SurfaceCard label=\"Run\"><SectionHeader title=\"Steps\" /></SurfaceCard>", errors: [{ messageId: "title" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <SurfaceCard label=\"Run\"><Heading level={3}>Steps</Heading></SurfaceCard>", errors: [{ messageId: "title" }] },
      // a custom zone holds none of the parts the typed zones draw
      { filename: BLOCK, code: IMPORTS + "export const A = () => <SurfaceCard kind=\"list\" label=\"Run\" items={[]} empty={null} headers={[{ kind: \"custom\", children: <Tabs label=\"x\" items={[]} /> }]} />", errors: [{ messageId: "zone" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <SurfaceCard kind=\"list\" label=\"Run\" items={[]} empty={null} footers={[{ kind: \"custom\", children: <><Text>a</Text><Divider /></> }]} />", errors: [{ messageId: "zone" }] },
    ],
  })
})

test("R366: a labelled card is not repeated in a Grid of cards", () => {
  slotTester().run("no-label-in-grid", noLabelInGrid, {
    valid: [
      // tiles name themselves inside
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Grid kind=\"cards\">{items.map((i) => <SurfaceCard key={i.id} kind=\"tile\" name={i.name} mark={i.mark} />)}</Grid>" },
      // one labelled card in a grid is not repeated
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Grid kind=\"cards\"><SurfaceCard label=\"a\" /></Grid>" },
      // other grids hold what they hold
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Grid kind=\"main-rail\"><SurfaceCard label=\"a\" /><SurfaceCard label=\"b\" /></Grid>" },
      // an unlabelled card repeats freely
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Grid kind=\"cards\"><SurfaceCard ariaLabel=\"a\" /><SurfaceCard ariaLabel=\"b\" /></Grid>" },
      { filename: SCRIPT, code: IMPORTS + "export const A = () => <Grid kind=\"cards\"><SurfaceCard label=\"a\" /><SurfaceCard label=\"b\" /></Grid>" },
    ],
    invalid: [
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Grid kind=\"cards\"><SurfaceCard label=\"a\" /><SurfaceCard label=\"b\" /></Grid>", errors: [{ messageId: "tile" }, { messageId: "tile" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Grid kind=\"cards\">{items.map((i) => <SurfaceCard key={i.id} label={i.name} />)}</Grid>", errors: [{ messageId: "tile" }] },
    ],
  })
})
