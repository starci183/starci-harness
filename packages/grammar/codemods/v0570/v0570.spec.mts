/**
 * The v0570 codemod: Icon usages become roles, Disclosure chevron is dropped, LogoStack is marked.
 *
 *   node --test codemods/v0570/v0570.spec.mts
 */
import assert from "node:assert/strict"
import test from "node:test"
import ts from "typescript"
import { MARK, transformSource } from "./index.mts"

const run = (source: string) => transformSource(ts, "a.tsx", source)

test("Icon usage chip and leading become control, heading becomes head; text stays", () => {
    const out = run(`import { Icon as G } from "@starci/grammar/core"\nexport const A = () => <><G source={X} usage="chip" /><G source={X} usage={"leading"} /><G source={X} usage="heading" /><G source={X} usage="text" /></>\n`)
    assert.match(out.text, /usage="control" \/><G source=\{X\} usage=\{"control"\} \/><G source=\{X\} usage="head" \/><G source=\{X\} usage="text"/)
    assert.equal(out.findings.length, 3)
})

test("a namespace Icon and inlineGlyph are rewritten; another element's usage is left", () => {
    const out = run(`import * as N from "@starci/grammar/common"\nimport { inlineGlyph } from "@starci/grammar/core"\nexport const A = () => <><N.Icon source={X} usage="chip" /><Other usage="chip" />{inlineGlyph("close", {}, "leading")}</>\n`)
    assert.match(out.text, /<N\.Icon source=\{X\} usage="control" \/><Other usage="chip" \/>\{inlineGlyph\("close", \{\}, "control"\)\}/)
})

test("Disclosure chevron is dropped", () => {
    const out = run(`import { Disclosure } from "@starci/grammar/core"\nexport const A = () => <Disclosure title="T" chevron="end" body={null} />\n`)
    assert.match(out.text, /<Disclosure title="T" body=\{null\} \/>/)
    assert.equal(out.findings.length, 1)
})

test("LogoStack is marked once per statement, and a second run adds no second mark", () => {
    const source = `import { LogoStack } from "@starci/grammar/core"\nexport const A = () => <LogoStack label="L" items={[]} />\n`
    const once = run(source)
    assert.equal(once.text.split(MARK).length - 1, 2)
    const twice = run(once.text)
    assert.equal(twice.text.split(MARK).length - 1, 2)
})

test("a source with no Grammar import is left untouched", () => {
    const source = `export const A = () => <Icon usage="chip" />\n`
    assert.equal(run(source).text, source)
})
