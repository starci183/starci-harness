/**
 * Twin tests for the back-end config factory.
 *
 *   node --test src/config.spec.ts
 *
 * The failures worth catching: a rule published at anything but `error`, a config that a repository could weaken
 * (globs, ignores, overrides), a config without typed linting or without the HFS settings the path-scoped rules read,
 * and a view that is not the be side of an app.
 */
import assert from "node:assert/strict"
import test from "node:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { TSESLint } from "@typescript-eslint/utils"
import type { RuleEntry } from "./lib/rule.ts"
import plugin, { linterOptions, loadHfs, recommended, starciBeConfig } from "./index.ts"
import { BORROWED, IGNORED, SOURCE_FILES, buildBeConfig } from "./lib/config.ts"
import { BE_DECLARATION, fixtureHfs } from "../fixtures/typed/tester.mjs"
import { appDeclaration } from "../fixtures/app.mjs"

const levelOf = (setting: RuleEntry | undefined): RuleEntry | undefined => (Array.isArray(setting) ? setting[0] : setting)

/** The rule block of a factory config (its second block), proven present. */
const ruleBlockOf = (config: TSESLint.FlatConfig.ConfigArray): TSESLint.FlatConfig.Config => {
    const block = config[1]
    assert.ok(block, "the config has a rule block")
    return block
}

/** The rules of a rule block, proven present. */
const rulesOf = (block: TSESLint.FlatConfig.Config): TSESLint.SharedConfig.RulesRecord => {
    assert.ok(block.rules, "the rule block has rules")
    return block.rules
}

/** The HFS view the rule block hands the rules under `settings.starci.hfs`. */
const settingsHfsOf = (block: TSESLint.FlatConfig.Config): unknown => {
    const starci = block.settings?.["starci"]
    assert.ok(typeof starci === "object" && starci !== null && "hfs" in starci, "the rule block carries settings.starci.hfs")
    return starci.hfs
}

test("every published rule ships at error", () => {
    const weak = Object.entries(recommended).filter(([, setting]) => levelOf(setting) !== "error")
    assert.deepEqual(weak, [])
    assert.deepEqual(Object.keys(recommended).sort(), Object.keys(plugin.rules).map((name) => `starci-be/${name}`).sort())
})

test("the config is one ignore block and one typed rule block over every source, with the HFS settings", async () => {
    const hfs = fixtureHfs()
    const config = await starciBeConfig({ hfs })
    const block = ruleBlockOf(config)
    const rules = rulesOf(block)
    assert.deepEqual(config[0], { ignores: [...IGNORED] })
    assert.deepEqual(IGNORED, ["dist/**", "coverage/**", "**/node_modules/**"])
    assert.deepEqual(block.files, [...SOURCE_FILES])
    assert.ok(block.languageOptions?.parserOptions?.projectService, "typed linting is on")
    assert.equal(block.languageOptions?.parserOptions?.tsconfigRootDir, hfs.repoRoot)
    assert.equal(settingsHfsOf(block), hfs)
    assert.deepEqual(block.linterOptions, linterOptions)
    assert.deepEqual(linterOptions, { noInlineConfig: true, reportUnusedDisableDirectives: "error" })
    assert.equal(block.plugins?.["starci-be"], plugin)
    assert.ok(block.plugins?.["@typescript-eslint"]?.rules, "the borrowed rules have their plugin")
    for (const [name, setting] of Object.entries(rules)) assert.equal(levelOf(setting), "error", `${name} is not an error`)
    for (const name of Object.keys(BORROWED)) assert.ok(name in rules, `${name} is borrowed`)
    assert.deepEqual(rules["@typescript-eslint/consistent-type-assertions"], ["error", { assertionStyle: "never" }])
    for (const name of ["no-unsafe-assignment", "no-unsafe-member-access", "no-unsafe-call", "no-unsafe-return", "no-unsafe-argument"]) {
        assert.equal(rules[`@typescript-eslint/${name}`], "error", `${name} is borrowed at error`)
    }
})

test("the factory takes only the HFS view: no globs, ignores or rule overrides", async () => {
    // a JavaScript caller can pass anything; the extra keys reach the factory through a variable, as they would from a config file
    const input = { hfs: fixtureHfs(), files: ["src/**"], rules: { "starci-be/error-home": "off" }, ignores: ["src/**"] }
    const block = ruleBlockOf(await starciBeConfig(input))
    assert.deepEqual(block.files, [...SOURCE_FILES])
    assert.equal(rulesOf(block)["starci-be/error-home"], "error")
})

test("a missing HFS view, the view of the fe side or a weakened recommendation is refused", async () => {
    await assert.rejects(() => starciBeConfig({}), /loadHfs\(import\.meta\.url\)/)
    await assert.rejects(() => starciBeConfig({ hfs: { ...fixtureHfs(), profile: "fe", side: "fe" } }), /this view is the fe side/)
    await assert.rejects(() => buildBeConfig({ hfs: fixtureHfs(), plugin, recommended: { ...recommended, "starci-be/error-home": "warn" } }), /not at error: starci-be\/error-home/)
    await assert.rejects(() => buildBeConfig({ hfs: fixtureHfs(), plugin, recommended: { ...recommended, "starci-be/error-home": ["off"] } }), /not at error/)
    await assert.rejects(() => buildBeConfig({ hfs: fixtureHfs(), plugin, recommended: {} }), /empty recommendation/)
})

test("loadHfs finds the app-root hfs.json above be/ and gives every file under be/ the view of the be side", async () => {
    assert.equal(typeof loadHfs, "function")
    assert.throws(() => loadHfs(new URL("./no-such-dir/eslint.config.mjs", import.meta.url).href), /hfs\.json/)
    const app = mkdtempSync(join(tmpdir(), "starci-loadhfs-"))
    try {
        writeFileSync(join(app, "hfs.json"), JSON.stringify(appDeclaration("be", BE_DECLARATION)))
        mkdirSync(join(app, "be"))
        const view = loadHfs(pathToFileURL(join(app, "be", "eslint.config.mjs")).href)
        assert.equal(view.side, "be")
        assert.equal(view.profile, "be")
        assert.equal(view.repoRoot, join(app, "be"))
        assert.equal(view.slotOf(join(app, "be", "src", "modules", "domain", "order", "order.service.ts")), "be.domain")
        assert.equal(view.slotOf(join(app, "fe", "apps", "web", "src", "app", "page.tsx")), null, "a file of the other side is no be slot")
        // an eslint.config.mjs at the app root would see the app root, which no canon lints
        await assert.rejects(async () => starciBeConfig({ hfs: loadHfs(pathToFileURL(join(app, "eslint.config.mjs")).href) }), /this view is the app root/)
    } finally {
        rmSync(app, { recursive: true, force: true })
    }
})

test("the borrowed cast rules reach a unit spec: no `as` and no `x!` in a `.service.spec.ts`", async () => {
    const { Linter } = TSESLint
    const { default: tsParser } = await import("@typescript-eslint/parser")
    const block = ruleBlockOf(await starciBeConfig({ hfs: fixtureHfs() }))
    const borrowed = Object.fromEntries(Object.entries(rulesOf(block)).filter(([name]) => name === "@typescript-eslint/consistent-type-assertions" || name === "@typescript-eslint/no-non-null-assertion"))
    const lint = (code: string, filename: string) => new Linter({ configType: "flat" }).verify(code, [{ ...block, languageOptions: { parser: tsParser, ecmaVersion: "latest", sourceType: "module" }, rules: borrowed }], { filename })
    const spec = "src/modules/domain/order/order.service.spec.ts"
    assert.deepEqual(lint("declare const raw: unknown\nexport const row = raw as { id: number }", spec).map((message) => message.ruleId), ["@typescript-eslint/consistent-type-assertions"])
    assert.deepEqual(lint("declare const raw: { id?: number }\nexport const id = raw.id!", spec).map((message) => message.ruleId), ["@typescript-eslint/no-non-null-assertion"])
    assert.deepEqual(lint("declare const raw: { id?: number }\nexport const id = raw.id ?? 0", spec), [])
})
