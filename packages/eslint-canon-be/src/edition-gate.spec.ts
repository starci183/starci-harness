import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import test from "node:test"
import plugin from "./index.ts"
import { pluginForEdition } from "./lib/edition.ts"
import { enforcerJudgedInEdition } from "../runtime/scripts/hfs/edition-slots.mjs"
import { loadRuleCatalog } from "../runtime/scripts/hfs/slots.mjs"
import { ruleNamed } from "../fixtures/rule-tester.mjs"
import type { RuleModule } from "./lib/rule.ts"

const RUNTIME = fileURLToPath(new URL("../runtime/", import.meta.url))
const catalog = loadRuleCatalog({ root: RUNTIME })

/** A rule that registers one empty listener: a stand-in whose identity the gate either keeps or replaces. */
const standInRule = (): RuleModule => Object.freeze<RuleModule>({ meta: { type: "problem", schema: [], messages: {} }, create: () => ({ Program() {} }) })

/** What a rule's `create` returns when ESLint hands it no context (an inactive rule ignores its context). */
const createdWithoutContext = (rule: { create: (...args: never[]) => unknown }): unknown => rule.create()

/**
 * An HFS stand-in whose `edition` is any value, as a JavaScript caller can pass it. The view's declared type says a string;
 * the gate exists to refuse what is not one, so the value is set as a property rather than typed.
 */
const hfsWithEdition = (edition: unknown): { readonly edition?: string } => Object.defineProperty({}, "edition", { value: edition, enumerable: true })

test("every published back-end rule follows the bundled catalog in both editions", () => {
    for (const edition of ["full", "lite"]) {
        const gated = pluginForEdition({ plugin, hfs: { edition }, catalog })
        for (const [id, rule] of Object.entries(plugin.rules)) {
            assert.equal(
                gated.rules[id] === rule,
                catalog.enforcerJudgedIn("eslint-be", id, edition),
                `${id} disagrees with knowledge/hfs/rules.yaml in ${edition}`,
            )
        }
    }
})

test("full keeps the exact plugin and every exact rule object", () => {
    const gated = pluginForEdition({ plugin, hfs: {} })
    assert.equal(gated, plugin)
    for (const [id, rule] of Object.entries(plugin.rules)) assert.equal(gated.rules[id], rule, id)
})

test("an uncatalogued lint rule runs in every edition", () => {
    const rule = standInRule()
    const extended = Object.freeze({ ...plugin, rules: Object.freeze({ ...plugin.rules, "future-law": rule }) })
    for (const edition of ["full", "lite"]) {
        const gated = pluginForEdition({ plugin: extended, hfs: { edition }, catalog })
        assert.equal(gated.rules["future-law"], rule)
    }
})

test("an enforcer shared by two catalog rules runs only where both owners are judged", () => {
    const rule = standInRule()
    const shared = Object.freeze({ rules: Object.freeze({ shared: rule }) })
    const rules = [
        { editions: ["full", "lite"], enforcers: [{ kind: "eslint-be", id: "shared" }] },
        { editions: ["full"], enforcers: [{ kind: "eslint-be", id: "shared" }] },
    ]
    const twoOwnerCatalog = {
        enforcerJudgedIn: (kind: string, id: string, edition: "full" | "lite") => enforcerJudgedInEdition(rules, kind, id, edition),
    }

    assert.equal(pluginForEdition({ plugin: shared, hfs: { edition: "full" }, catalog: twoOwnerCatalog }).rules.shared, rule)
    assert.deepEqual(createdWithoutContext(ruleNamed(pluginForEdition({ plugin: shared, hfs: { edition: "lite" }, catalog: twoOwnerCatalog }).rules, "shared")), {})
})

test("unknown and null editions are refused before catalog filtering", () => {
    for (const edition of ["enterprise", "", null]) {
        assert.throws(() => pluginForEdition({ plugin, hfs: hfsWithEdition(edition), catalog }), /Unknown HFS edition/u)
    }
})
