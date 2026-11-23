/**
 * v0551 (Grammar 0.55.1): the graph ext's phone switch is deleted; each use of `shared.PHONE_WIDTH` or `shared.usePhone` is marked for a person.
 *
 *   node --test codemods/v0551/v0551.spec.mts
 */
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import ts from "typescript"
import { CODEMODS, codemodsBetween } from "../index.mts"
import { DELETED_SHARED, MARK, dropAlertActionIcon, runV0551, transformSource, v0551Markdown } from "./index.mts"

const IMPORT = 'import { FlowGraph, shared } from "@starci/grammar/core/ext/graph"\n'

test("the members it marks are gone from the graph ext's shared namespace", () => {
    const index = readFileSync(fileURLToPath(new URL("../../src/core/ext/graph/shared/index.ts", import.meta.url)), "utf8")
    for (const member of Object.keys(DELETED_SHARED)) assert.doesNotMatch(index, new RegExp(`\b${member}\b`, "u"), member)
})

test("a use of shared.usePhone or shared.PHONE_WIDTH is marked once, with what to do", () => {
    const code = `${IMPORT}export const A = () => {\n    const phone = shared.usePhone()\n    return phone ? null : <FlowGraph label="x" nodes={[]} edges={[]} statusLabels={l} />\n}\nconst wide = window.innerWidth >= shared.PHONE_WIDTH\n`
    const out = transformSource(ts, "a.tsx", code)
    assert.equal(out.findings.length, 2)
    assert.match(out.text, new RegExp(`    // ${MARK.replace(/[()]/gu, "\\$&")}: shared\\.usePhone is deleted in 0\\.55\\.1; use nothing: a graph is the same on every screen[^\\n]*\\n    const phone = shared\\.usePhone\\(\\)`, "u"))
    assert.match(out.text, /\/\/ TODO\(grammar-0\.55\.1\): shared\.PHONE_WIDTH is deleted in 0\.55\.1[^\n]*\nconst wide/u)
    // Run again: nothing is doubled.
    assert.equal(transformSource(ts, "a.tsx", out.text).text, out.text)
})

test("an alias of shared and a destructured member are read; another module's shared and a file without the graph are left", () => {
    const alias = 'import { shared as graph } from "@starci/grammar/core/ext/graph"\nconst { usePhone, FlowZoom } = graph\n'
    assert.match(transformSource(ts, "b.ts", alias).text, /^import [^\n]*\n\/\/ TODO\(grammar-0\.55\.1\): shared\.usePhone is deleted/u)
    const other = 'import { shared } from "./local"\nconst w = shared.PHONE_WIDTH\n'
    assert.equal(transformSource(ts, "c.ts", other).text, other)
    const fine = `${IMPORT}const z = shared.FlowZoom\n`
    assert.equal(transformSource(ts, "d.ts", fine).text, fine)
})

test("runV0551 walks an app checkout, dry unless written, and is listed for an upgrade to 0.55.1", () => {
    const root = mkdtempSync(join(tmpdir(), "v0551-"))
    try {
        const dir = join(root, "apps", "web", "src")
        mkdirSync(dir, { recursive: true })
        const file = join(dir, "graph.tsx")
        writeFileSync(file, `${IMPORT}const w = shared.PHONE_WIDTH\n`)
        const dry = runV0551({ root, write: false, ts })
        assert.equal(dry.findings.length, 1)
        assert.equal(readFileSync(file, "utf8"), `${IMPORT}const w = shared.PHONE_WIDTH\n`)
        assert.match(v0551Markdown(dry), /1 uses of a deleted 0.55.1 API in 1 files/u)
        runV0551({ root, write: true, ts })
        assert.match(readFileSync(file, "utf8"), /TODO\(grammar-0\.55\.1\)/u)
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
    assert.deepEqual(codemodsBetween("0.55.0", "0.55.1").map((codemod) => codemod.id), ["v0551"])
    assert.ok(CODEMODS.some((codemod) => codemod.id === "v0551" && codemod.version === "0.55.1"))
})

test("an Alert action's deleted icon is dropped from a Grammar Alert (named, aliased or namespaced); another element's action is left", () => {
    const named = 'import { Alert } from "@starci/grammar/core"\nexport const A = () => <Alert tone="cautionary" title="t" action={{ label: "Enable", icon: power, onAction: go }} />\n'
    const out = dropAlertActionIcon(ts, "a.tsx", named)
    assert.equal(out.findings.length, 1)
    assert.equal(out.text, 'import { Alert } from "@starci/grammar/core"\nexport const A = () => <Alert tone="cautionary" title="t" action={{ label: "Enable", onAction: go }} />\n')
    assert.equal(dropAlertActionIcon(ts, "a.tsx", out.text).text, out.text, "a second run changes nothing")
    const last = 'import * as G from "@starci/grammar"\nconst b = <G.Alert title="t" action={{ label: "Go", onAction: go, icon: power }} />\n'
    assert.equal(transformSource(ts, "b.tsx", last).text, 'import * as G from "@starci/grammar"\nconst b = <G.Alert title="t" action={{ label: "Go", onAction: go }} />\n')
    const alias = 'import { Alert as Banner } from "@starci/grammar/core"\nconst c = <Banner title="t" action={{ icon: power, label: "Go", onAction: go }} />\n'
    assert.match(transformSource(ts, "c.tsx", alias).text, /action=\{\{ label: "Go", onAction: go \}\}/u)
    const other = 'import { Alert } from "./local"\nconst d = <Alert action={{ label: "Go", icon: power, onAction: go }} />\n'
    assert.equal(transformSource(ts, "d.tsx", other).text, other)
})
