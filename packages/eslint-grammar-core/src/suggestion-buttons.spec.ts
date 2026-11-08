/**
 * Twin tests for the suggestion buttons law (`FE_SUGGESTION_BUTTONS`).
 *
 *   node --test src/suggestion-buttons.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { recommended, rules, suggestionButtons } from "./suggestion-buttons.ts"

const BLOCK = at("apps/web/src/components/blocks/Runs/component.tsx")
const SCRIPT = at("scripts/build.tsx")
const IMPORT = "import { Button, ChoiceChips, Cluster, Link, Stack, TagGroup, Badge } from \"@starci/grammar\"\n"
const HERO = "import { Chip } from \"@heroui/react\"\n"
const link = (label: string): string => `<Link href="#" onFollow={() => send(${label})}>{${label}}</Link>`

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(rules), ["suggestion-buttons"])
  assert.deepEqual(recommended, { "starci-grammar/suggestion-buttons": "error" })
})

test("FE_SUGGESTION_BUTTONS: Links, ChoiceChips and Chips that send are red; a Cluster of neutral sm Buttons is the pattern", () => {
  slotTester().run("suggestion-buttons", suggestionButtons, {
    valid: [
      // the one pattern: a Cluster of neutral sm Buttons that send their own label
      { filename: BLOCK, code: IMPORT + "export const A = () => <Cluster gap=\"inline\" label=\"Suggested\">{qs.map((q) => <Button key={q} size=\"sm\" onPress={() => send(q)}>{q}</Button>)}</Cluster>" },
      // one Link that is not in a map is not a row; a real href is navigation
      { filename: BLOCK, code: IMPORT + `export const A = () => <Cluster>${link("q")}</Cluster>` },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Cluster>{items.map((item) => <Link key={item.id} href={item.href} onFollow={() => track(item.label)}>{item.label}</Link>)}</Cluster>" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Cluster><Link href=\"/a\" onFollow={() => open(a)}>{a}</Link><Link href=\"/b\" onFollow={() => open(b)}>{b}</Link></Cluster>" },
      // a Link whose handler sends something else
      { filename: BLOCK, code: IMPORT + "export const A = () => <Cluster>{items.map((item) => <Link key={item.id} href=\"#\" onFollow={() => open(item.id)}>{item.label}</Link>)}</Cluster>" },
      // ChoiceChips that keep the choice, forward it, or are ambiguous
      { filename: BLOCK, code: IMPORT + "export const A = () => <ChoiceChips label=\"Period\" options={o} value={v} onValueChange={setValue} />" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <ChoiceChips label=\"Period\" options={o} value={v} onValueChange={(next) => setValue(next)} />" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <ChoiceChips label=\"Period\" options={o} value={v} onValueChange={(next) => onChange(next)} />" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <ChoiceChips label=\"Period\" options={o} value={v} {...rest} onValueChange={(next) => send(next)} />" },
      // Badge and TagGroup take no label-sending action
      { filename: BLOCK, code: IMPORT + "export const A = () => <Cluster><Badge>New</Badge><TagGroup label=\"Tags\" items={t} onRemove={(ids) => drop(ids)} /></Cluster>" },
      // a Chip without an action, a local Chip, a script
      { filename: BLOCK, code: HERO + "export const A = () => <Chip>Draft</Chip>" },
      { filename: BLOCK, code: "const Chip = (p) => p.children\nexport const A = () => <Chip onPress={() => send(q)}>{q}</Chip>" },
      { filename: SCRIPT, code: IMPORT + `export const A = () => <Cluster>${link("a")}${link("b")}</Cluster>` },
    ],
    invalid: [
      { filename: BLOCK, code: IMPORT + "export const A = () => <Cluster>{qs.map((q) => <Link key={q} href=\"#\" onFollow={() => send(q)}>{q}</Link>)}</Cluster>", errors: [{ messageId: "element" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Stack>{items.map((item) => <Link key={item.id} onPress={() => ask(item.label)}>{item.label}</Link>)}</Stack>", errors: [{ messageId: "element" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Cluster><Link href=\"#\" onFollow={() => send(\"Why?\")}>Why?</Link><Link href=\"#\" onFollow={() => send(\"How?\")}>{\"How?\"}</Link></Cluster>", errors: [{ messageId: "element" }, { messageId: "element" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Cluster><>" + link("a") + "</>" + link("b") + "</Cluster>", errors: [{ messageId: "element" }, { messageId: "element" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <ChoiceChips label=\"Ask\" options={o} onValueChange={(v) => send(v)} />", errors: [{ messageId: "element" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <ChoiceChips label=\"Ask\" options={o} onValueChange={(v) => { chat.ask(v) }} />", errors: [{ messageId: "element" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <ChoiceChips label=\"Ask\" options={o} onValueChange={send} />", errors: [{ messageId: "element" }] },
      { filename: BLOCK, code: HERO + "export const A = () => <div>{qs.map((q) => <Chip key={q} onPress={() => send(q)}>{q}</Chip>)}</div>", errors: [{ messageId: "element" }] },
    ],
  })
})
