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
import { DELETED_SHARED, MARK, runV0551, transformSource, v0551Markdown } from "./index.mts"

const IMPORT = 'import { FlowGraph, shared } from "@starci/grammar/core/ext/graph"\n'

test("the members it marks are gone from the graph ext's shared namespace", () => {
    const index = readFileSync(fileURLToPath(new URL("../../src/core/ext/graph/shared/index.ts", import.meta.url)), "utf8")
    for (const member of Object.keys(DELETED_SHARED)) assert.doesNotMatch(index, new RegExp(`\b${member}\b`, "u"), member)
})

test("a use of shared.usePhone or shared.PHONE_WIDTH is marked once, with what to do", () => {
    const code = `${IMPORT}export const A = () => {\n    const phone = shared.usePhone()\n    return phone ? null : <FlowGraph label="x" nodes={[]} edges={[]} statusLabels={l} />\n}\nconst wide = window.innerWidth >= shared.PHONE_WIDTH\n`
    const out = transformSource(ts, "a.tsx", code)
    assert.equal(out.findings.length, 2)
    assert.match(out.text, new RegExp(`    // ${MARK.replace(/[()]/gu, "\\$&")}: shared\\.usePhone is deleted in 0\\.55\\.1; use nothing: a graph lays itself out top-down under 480px[^\\n]*\\n    const phone = shared\\.usePhone\\(\\)`, "u"))
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

test("a MermaidDiagram import from a core entry moves to the graph ext with its types; the rest stays; a namespace use is marked", () => {
    const whole = 'import { MermaidDiagram, type MermaidTone } from "@starci/grammar/core"\n'
    const moved = transformSource(ts, "w.tsx", whole)
    assert.equal(moved.text, 'import { MermaidDiagram, type MermaidTone } from "@starci/grammar/core/ext/graph"\n')
    assert.equal(moved.findings.length, 1)
    const split = transformSource(ts, "s.tsx", 'import { Text, MermaidDiagram } from "@starci/grammar/offset-pop";\n')
    assert.equal(split.text, 'import { Text } from "@starci/grammar/offset-pop";\nimport { MermaidDiagram } from "@starci/grammar/core/ext/graph";\n')
    assert.equal(transformSource(ts, "again.tsx", moved.text).text, moved.text)
    const namespace = 'import * as G from "@starci/grammar/core"\nexport const A = () => <G.MermaidDiagram source="" label="x" />\n'
    const marked = transformSource(ts, "n.tsx", namespace)
    assert.match(marked.text, /TODO\(grammar-0\.55\.1\): MermaidDiagram is no longer in the core entries/u)
    const other = 'import { MermaidDiagram } from "./local"\n'
    assert.equal(transformSource(ts, "o.tsx", other).text, other)
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
        assert.match(v0551Markdown(dry), /1 uses of a deleted graph member or a moved MermaidDiagram in 1 files/u)
        runV0551({ root, write: true, ts })
        assert.match(readFileSync(file, "utf8"), /TODO\(grammar-0\.55\.1\)/u)
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
    assert.deepEqual(codemodsBetween("0.55.0", "0.55.1").map((codemod) => codemod.id), ["v0551"])
    assert.ok(CODEMODS.some((codemod) => codemod.id === "v0551" && codemod.version === "0.55.1"))
})
