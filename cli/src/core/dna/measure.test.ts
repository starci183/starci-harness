// The in-page measure on a fixture page, in a real browser: a scoped count, an accessible name through aria-labelledby, and a size
// under a press scale. Skipped where no Chromium is installed (name one with STARCI_BROWSER).
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { findBrowser } from "./browser.js"
import { dnaCheckVerb } from "./check.js"
import type { LawRow } from "./check.js"

const browser = ((): string | undefined => {
    try {
        return findBrowser(undefined)
    } catch {
        return undefined
    }
})()

const CONTRACT = [
    "schema: starci/grammar-contract@1",
    "grammars: [core]",
    "mustKeep:",
    "  shape: {}",
    "  common:",
    "    - id: DNA-COMMON-FIXTURE-SCOPED-COUNT",
    "      role: tabs",
    "      law: Each scope holds exactly one indicator.",
    "      measure: { kind: count, scope: '[data-component=\"Tabs\"]', select: '.tabs__indicator', op: \"=\", value: 1 }",
    "      owner: fixture",
    "    - id: DNA-COMMON-FIXTURE-NAMED",
    "      role: dialog",
    "      law: A dialog named by a labelled trigger has a name.",
    "      measure: { kind: a11y, select: 'document [role=\"dialog\"]', metric: name, op: set }",
    "      owner: fixture",
    "    - id: DNA-COMMON-FIXTURE-SIZE",
    "      role: button",
    "      law: A pressed button is as tall as the layout gives it.",
    "      measure: { kind: box, select: '[data-component=\"Button\"]', metric: height, op: \"=\", value: 40px }",
    "      owner: fixture",
    "  core: []",
    "",
].join("\n")

const PAGE = [
    "<!doctype html><html><body>",
    "<div data-grammar-family=\"core\" class=\"grammar-common-root\">",
    "<div data-component=\"Tabs\"><div class=\"tabs__indicator\"></div></div>",
    "<div data-component=\"Tabs\"><div class=\"tabs__indicator\"></div></div>",
    "<button id=\"opener\" aria-label=\"Open the menu\" aria-expanded=\"true\"><svg width=\"8\" height=\"8\"></svg></button>",
    "<div role=\"dialog\" aria-labelledby=\"opener\"></div>",
    "<button data-component=\"Button\" style=\"display:block;height:40px;width:80px;transform:scale(0.97)\">Go</button>",
    "</div></body></html>",
].join("\n")

void test("dna check counts inside the root a scope stands in, names a dialog by its trigger's aria-label and reads the layout size", { skip: browser === undefined }, async () => {
    const folder = mkdtempSync(join(tmpdir(), "starci-dna-measure-"))
    mkdirSync(join(folder, "grammars"), { recursive: true })
    mkdirSync(join(folder, "ui", "proof"), { recursive: true })
    writeFileSync(join(folder, "ui", "proof", "thresholds.yaml"), "schema: x\n")
    writeFileSync(join(folder, "grammars", "contract.yaml"), CONTRACT)
    writeFileSync(join(folder, "index.html"), PAGE)
    const context = { cwd: folder, tree: "none" as const, treeRoot: undefined, verbs: [], json: false, progress: (): void => undefined }
    const result = await dnaCheckVerb.run(context, { target: folder, storybook: undefined, url: undefined, stories: undefined, shard: undefined, browser: undefined, timeout: undefined, out: undefined, contract: join(folder, "grammars", "contract.yaml"), widths: "1280", routes: "index.html" })
    const data = result.data
    for (const law of data.laws) assert.equal(law.status, "green", `${law.id}: ${String(law.broken)} of ${String(law.evaluated)} broken`)
    assert.equal(data.laws.length, 3)
})

// DNA-COMMON-ONE-PRIMARY-PER-REGION, read from the real contract: one filled primary per region, a nested region counting its own.
const regionLaw = ((): string => {
    const lines = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "contexts", "grammars", "contract.yaml"), "utf8").split("\n")
    const start = lines.findIndex((line) => line.trim() === "- id: DNA-COMMON-ONE-PRIMARY-PER-REGION")
    const end = lines.findIndex((line, index) => index > start && line.trim().startsWith("- id: "))
    return lines.slice(start, end).join("\n")
})()

const REGION_CONTRACT = ["schema: starci/grammar-contract@1", "grammars: [core]", "mustKeep:", "  shape: {}", "  common:", regionLaw, "  core: []", ""].join("\n")

const button = (variant: string, label: string): string => `<button data-component="Button" data-grammar-variant="${variant}">${label}</button>`

const REGION_PASSING = [
    "<!doctype html><html><body><div data-grammar-family=\"core\" class=\"grammar-common-root\">",
    `<header data-component="PageHeader">${button("primary", "Create")}${button("border", "Export")}</header>`,
    `<section data-component="SurfaceCard">${button("primary", "Approve")}${button("border", "Reject")}${button("danger", "Delete")}`,
    `<section data-component="Section">${button("primary", "Save")}</section></section>`,
    "</div></body></html>",
].join("\n")

const REGION_FAILING = [
    "<!doctype html><html><body><div data-grammar-family=\"core\" class=\"grammar-common-root\">",
    `<section data-component="Section">${button("primary", "Approve")}${button("primary", "Send")}</section>`,
    "</div></body></html>",
].join("\n")

const runRegionLaw = async (page: string): Promise<readonly LawRow[]> => {
    const folder = mkdtempSync(join(tmpdir(), "starci-dna-region-"))
    mkdirSync(join(folder, "grammars"), { recursive: true })
    mkdirSync(join(folder, "ui", "proof"), { recursive: true })
    writeFileSync(join(folder, "ui", "proof", "thresholds.yaml"), "schema: x\n")
    writeFileSync(join(folder, "grammars", "contract.yaml"), REGION_CONTRACT)
    writeFileSync(join(folder, "index.html"), page)
    const context = { cwd: folder, tree: "none" as const, treeRoot: undefined, verbs: [], json: false, progress: (): void => undefined }
    const result = await dnaCheckVerb.run(context, { target: folder, storybook: undefined, url: undefined, stories: undefined, shard: undefined, browser: undefined, timeout: undefined, out: undefined, contract: join(folder, "grammars", "contract.yaml"), widths: "1280", routes: "index.html" })
    return result.data.laws
}

void test("one filled primary per region: a card, its nested section and the page head each keep one, border and danger never count", { skip: browser === undefined }, async () => {
    const laws = await runRegionLaw(REGION_PASSING)
    assert.equal(laws.length, 1)
    assert.equal(laws[0]?.id, "DNA-COMMON-ONE-PRIMARY-PER-REGION")
    assert.equal(laws[0]?.evaluated, 6, "the page head, the card and its section are each counted, in both themes")
    assert.equal(laws[0]?.status, "green", `${String(laws[0]?.broken)} of ${String(laws[0]?.evaluated)} broken`)
})

void test("two filled primaries in one Section fail, naming the region and the fix", { skip: browser === undefined }, async () => {
    const laws = await runRegionLaw(REGION_FAILING)
    const law = laws[0]
    assert.ok(law)
    assert.equal(law.status, "red")
    assert.match(law.examples[0]?.path ?? "", /data-component="Section"/)
    assert.match(law.law, /giữ 1 nút chính, nút còn lại đổi sang border/)
})
