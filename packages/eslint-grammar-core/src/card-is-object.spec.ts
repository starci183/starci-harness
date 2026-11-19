/**
 * Twin tests for the card law (CARD-OBJECT): a card is one object; a collection, a form or a placeholder stands flat, not in a card.
 *
 *   node --test src/card-is-object.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { cardIsObject, recommended, rules } from "./card-is-object.ts"

const BLOCK = at("apps/web/src/components/blocks/Runs/component.tsx")
const SCRIPT = at("scripts/render.tsx")
const IMPORTS = "import * as G from \"@starci/grammar/core\"\nimport { SurfaceCard, DataTable, ListBox, DisclosureList, Accordion, Timeline, BarChart, Sparkline, ProportionBar, MermaidDiagram, Section, Stack, Cluster, Grid, Text, Button, DescriptionList, Meter, Form, Fieldset, Input, Textarea, Select, ComboBox, SearchField, NumberField, RadioGroup, CheckboxGroup, EmptyNotice, Markdown, MarkdownArticle, Avatar } from \"@starci/grammar/core\"\n"
const code = (body: string): string => `${IMPORTS}export const A = () => ${body}`
const refused = { messageId: "collection" }

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(rules), ["card-is-object"])
  assert.deepEqual(recommended, { "starci-grammar/card-is-object": "error" })
})

test("CARD-OBJECT: a card whose only content is a collection, a form or a placeholder is refused", () => {
  slotTester().run("card-is-object", cardIsObject, {
    valid: [
      // the table, the list, the facts and the disclosures stand flat in their Section
      { filename: BLOCK, code: code("<Section title=\"Runs\" caption=\"Last 30 days\"><DataTable columns={c} rows={r} /></Section>") },
      { filename: BLOCK, code: code("<Section kind=\"list\" title=\"Runs\" items={rows} empty={null} />") },
      // an object: its name or facts beside a control, two or more contents
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\"><Text>3 failed</Text><DataTable columns={c} rows={r} /></SurfaceCard>") },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Agent\"><DescriptionList items={i} /><Button>Pause</Button></SurfaceCard>") },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\"><BarChart data={d} /><Text>Source</Text></SurfaceCard>") },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\"><Stack><BarChart data={d} /><Text>Source</Text></Stack></SurfaceCard>") },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Agent\" actions={<Button>Pause</Button>}><Text>Reads the inbox</Text></SurfaceCard>") },
      // copy, a single value, a timeline, a listbox: not a collection the law names
      { filename: BLOCK, code: code("<SurfaceCard label=\"Plan\"><Text>Hello</Text></SurfaceCard>") },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Quota\"><Meter value={3} /></SurfaceCard>") },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Log\"><Timeline items={i} /></SurfaceCard>") },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\"><ListBox items={i} /></SurfaceCard>") },
      // the sign-in form with no page around it
      { filename: BLOCK, code: code("<SurfaceCard measure=\"formCompact\" label=\"Sign in\"><Form onSubmit={s}><Input label=\"Email\" /></Form></SurfaceCard>") },
      // a tile and a kind that is not a literal
      { filename: BLOCK, code: code("<SurfaceCard kind=\"tile\" name=\"Gmail\" />") },
      { filename: BLOCK, code: code("<SurfaceCard kind={kind}><DataTable columns={c} rows={r} /></SurfaceCard>") },
      // a spread may bring more content
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\" {...rest}><DataTable columns={c} rows={r} /></SurfaceCard>") },
      // not the Grammar's SurfaceCard or table
      { filename: BLOCK, code: "import { SurfaceCard } from \"./mine\"\nimport { DataTable } from \"@starci/grammar/core\"\nexport const A = () => <SurfaceCard><DataTable columns={c} rows={r} /></SurfaceCard>" },
      { filename: BLOCK, code: "import { SurfaceCard } from \"@starci/grammar/core\"\nimport { DataTable } from \"./mine\"\nexport const A = () => <SurfaceCard label=\"R\"><DataTable /></SurfaceCard>" },
      // a script is not product source
      { filename: SCRIPT, code: code("<SurfaceCard label=\"Runs\"><DataTable columns={c} rows={r} /></SurfaceCard>") },
    ],
    invalid: [
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\"><DataTable columns={c} rows={r} /></SurfaceCard>"), errors: [refused] },
      { filename: BLOCK, code: code("<SurfaceCard kind=\"body\" label=\"Runs\"><DataTable columns={c} rows={r} /></SurfaceCard>"), errors: [refused] },
      // a Section of any kind in a card is a collection
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\"><Section kind=\"list\" items={rows} /></SurfaceCard>"), errors: [refused] },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\"><Section title=\"Runs\"><Text>x</Text></Section></SurfaceCard>"), errors: [refused] },
      { filename: BLOCK, code: code("<SurfaceCard><Section kind=\"figures\" ariaLabel=\"Totals\" items={f} /></SurfaceCard>"), errors: [refused] },
      // facts, disclosures
      { filename: BLOCK, code: code("<SurfaceCard label=\"Order\"><DescriptionList items={i} /></SurfaceCard>"), errors: [refused] },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Steps\"><DisclosureList label=\"Steps\" items={i} /></SurfaceCard>"), errors: [refused] },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Steps\"><Accordion items={i} /></SurfaceCard>"), errors: [refused] },
      // a form, a fieldset, a lone field
      { filename: BLOCK, code: code("<SurfaceCard label=\"Profile\"><Form onSubmit={s}><Input label=\"Name\" /></Form></SurfaceCard>"), errors: [refused] },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Profile\"><Fieldset legend=\"Name\"><Input label=\"Name\" /></Fieldset></SurfaceCard>"), errors: [refused] },
      { filename: BLOCK, code: code("<SurfaceCard><Input label=\"Name\" /></SurfaceCard>"), errors: [refused] },
      { filename: BLOCK, code: code("<SurfaceCard><Textarea label=\"Note\" /></SurfaceCard>"), errors: [refused] },
      { filename: BLOCK, code: code("<SurfaceCard><Select label=\"Role\" items={i} /></SurfaceCard>"), errors: [refused] },
      { filename: BLOCK, code: code("<SurfaceCard><ComboBox label=\"Role\" items={i} /></SurfaceCard>"), errors: [refused] },
      { filename: BLOCK, code: code("<SurfaceCard><SearchField label=\"Search\" /></SurfaceCard>"), errors: [refused] },
      { filename: BLOCK, code: code("<SurfaceCard><NumberField label=\"Seats\" /></SurfaceCard>"), errors: [refused] },
      { filename: BLOCK, code: code("<SurfaceCard><RadioGroup label=\"Plan\" items={i} /></SurfaceCard>"), errors: [refused] },
      { filename: BLOCK, code: code("<SurfaceCard><CheckboxGroup label=\"Scopes\" items={i} /></SurfaceCard>"), errors: [refused] },
      // a placeholder and markdown
      { filename: BLOCK, code: code("<SurfaceCard><EmptyNotice title=\"No runs\" /></SurfaceCard>"), errors: [refused] },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Notes\"><Markdown source={s} /></SurfaceCard>"), errors: [refused] },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Notes\"><MarkdownArticle source={s} /></SurfaceCard>"), errors: [refused] },
      // charts
      { filename: BLOCK, code: code("<SurfaceCard label=\"Usage\"><BarChart data={d} /></SurfaceCard>"), errors: [refused] },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Trend\"><Sparkline data={d} /></SurfaceCard>"), errors: [refused] },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Share\"><ProportionBar items={d} /></SurfaceCard>"), errors: [refused] },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Diagram\"><MermaidDiagram source={s} /></SurfaceCard>"), errors: [refused] },
      // through layout wrappers, namespace imports, blank text, a fragment, a condition, a card with actions
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\"><Stack><DataTable columns={c} rows={r} /></Stack></SurfaceCard>"), errors: [refused] },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\"><Grid><Cluster><DataTable columns={c} rows={r} /></Cluster></Grid></SurfaceCard>"), errors: [refused] },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\"><div><DataTable columns={c} rows={r} /></div></SurfaceCard>"), errors: [refused] },
      { filename: BLOCK, code: code("<G.SurfaceCard label=\"Runs\">\n  <G.DataTable columns={c} rows={r} />\n</G.SurfaceCard>"), errors: [refused] },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\"><><DataTable columns={c} rows={r} /></></SurfaceCard>"), errors: [refused] },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\">{ready && <DataTable columns={c} rows={r} />}</SurfaceCard>"), errors: [refused] },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\" labelEnd={<Button>Add</Button>}><BarChart data={d} /></SurfaceCard>"), errors: [refused] },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\" actions={<Button>Add</Button>}><DataTable columns={c} rows={r} /></SurfaceCard>"), errors: [refused] },
      // a form card that is not the compact sign-in measure
      { filename: BLOCK, code: code("<SurfaceCard measure=\"narrow\" label=\"Profile\"><Form onSubmit={s}><Input label=\"Name\" /></Form></SurfaceCard>"), errors: [refused] },
    ],
  })
})

test("CARD-OBJECT: the message names the replacement of each content", () => {
  assert.match(cardIsObject.meta?.messages?.collection ?? "", /^SurfaceCard holds only {{content}}: a card is one object/)
  const head = "SurfaceCard holds only "
  const object = ": a card is one object (a customer, an agent, a plan, a message). "
  const case_ = (body: string, content: string, fix: string): { filename: string; code: string; errors: { message: string }[] } => ({ filename: BLOCK, code: code(body), errors: [{ message: head + content + object + fix }] })
  slotTester().run("card-is-object", cardIsObject, {
    valid: [],
    invalid: [
      case_("<SurfaceCard label=\"Runs\"><DataTable columns={c} rows={r} /></SurfaceCard>", "a `DataTable`", "Put the table flat under its Section (`<Section title ...><DataTable .../></Section>`)."),
      case_("<SurfaceCard><Section kind=\"list\" items={rows} /></SurfaceCard>", "a `Section kind=\"list\"`", "A list is flat: drop the card and keep `<Section kind=\"list\" title ... items={...} />`, which titles itself."),
      case_("<SurfaceCard><DescriptionList items={i} /></SurfaceCard>", "a `DescriptionList`", "Put the facts flat under a Section (`<Section title ...><DescriptionList isDivided items={...} /></Section>`); the facts of ONE object stay in that object's card beside its name or a control."),
      case_("<SurfaceCard><DisclosureList items={i} /></SurfaceCard>", "disclosures", "Put the disclosures flat under a Section (`<Section title ...><DisclosureList items={...} /></Section>`)."),
      case_("<SurfaceCard><Form onSubmit={s}><Input label=\"Name\" /></Form></SurfaceCard>", "a form", "Put the form flat under a Section (`<Section title ...><Form .../></Section>`); a sign-in form with no page around it keeps `measure=\"formCompact\"`."),
      case_("<SurfaceCard><EmptyNotice title=\"No runs\" /></SurfaceCard>", "an `EmptyNotice`", "An empty state stands on its own: drop the card and keep the `EmptyNotice`."),
      case_("<SurfaceCard><Markdown source={s} /></SurfaceCard>", "`Markdown`", "Put the text flat under a Section (`<Section title ...><Markdown .../></Section>`)."),
      case_("<SurfaceCard><BarChart data={d} /></SurfaceCard>", "a chart", "Put the chart flat under a Section (`<Section title ...><BarChart .../></Section>`)."),
    ],
  })
})
