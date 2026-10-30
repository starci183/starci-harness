/**
 * Twin tests for the gathered back-end plugin.
 *
 *   node --test src/index.spec.ts
 *
 * The failures worth catching here are the ones a build never reports: a law module nobody imported,
 * whose rules then ship as a document; two laws publishing one rule name, where whichever imports
 * last silently wins; and a rule absent from the recommended set, which reaches a consuming
 * repository switched off while looking adopted. The shared contract lives in
 * ./fixtures/gathered-plugin.ts; what follows is the back end's own.
 */
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { dirname } from "node:path"
import test from "node:test"
import plugin, { lawOwners, recommended, ruleDeclarations, rules } from "./index.ts"
import { gatheredPluginSpec } from "../fixtures/gathered-plugin.ts"
import { pluginForEdition } from "./lib/edition.ts"
import { ruleNamed } from "../fixtures/rule-tester.ts"
import type { RuleEntry } from "./lib/rule.ts"

const HERE = dirname(fileURLToPath(import.meta.url))

/** What a rule's `create` returns when ESLint hands it no context (an inactive rule ignores its context). */
const createdWithoutContext = (rule: { create: (...args: never[]) => unknown }): unknown => rule.create()

gatheredPluginSpec({ side: "be", dir: HERE, plugin, lawOwners, recommended, ruleDeclarations, rules })

test("be: every level is one a linter understands", () => {
    // A law may ask for a stock rule WITH options - `["error", { ... }]` - so the level is the head
    // of the entry rather than the entry itself. Reading only the plain form reported those as
    // broken, which is the gate being wrong about a shape ESLint has always accepted.
    const levelOf = (entry: RuleEntry): unknown => (Array.isArray(entry) ? entry[0] : entry)
    const levels: readonly unknown[] = ["error", "warn", "off"]
    const strange = Object.entries(recommended).filter(
        ([, entry]) => !levels.includes(levelOf(entry)),
    )
    assert.deepEqual(strange, [], "a level no linter accepts silently disables the rule it belongs to")
})

test("the generic edition gate disables a full-only catalog enforcer in lite and keeps it active in full", () => {
    const gated = "rest-door-needs-a-reason"
    const shared = "default-deny-guards"
    const catalog = { enforcerJudgedIn: (_kind: string, id: string, edition: "full" | "lite") => id !== gated || edition === "full" }

    const lite = pluginForEdition({ plugin, hfs: { edition: "lite" }, catalog })
    assert.deepEqual(createdWithoutContext(ruleNamed(lite.rules, gated)), {})
    assert.equal(lite.rules[shared], plugin.rules[shared])

    const full = pluginForEdition({ plugin, hfs: { edition: "full" }, catalog })
    assert.equal(full.rules[gated], plugin.rules[gated])
    assert.equal(full.rules[shared], plugin.rules[shared])
})
