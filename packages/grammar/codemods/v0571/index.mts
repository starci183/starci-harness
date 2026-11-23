/**
 * v0571: the codemod of Grammar 0.57.1, the neutral Sparkline (owner 2026-11-23; contexts/ui/components/charts.md).
 *
 * - `Sparkline tone` is deleted: the line is always the neutral muted ink, never a status colour (the words beside it carry the direction
 *   and the status). The attribute is dropped.
 * - `Sparkline emptyLabel` is deleted: no data, or a series of zeros only, draws no line and no box, so there are no empty words to show.
 *   The attribute is dropped.
 *
 * Rewritten on a Grammar `Sparkline` (a named import, an alias or `X.Sparkline` of a namespace import of `@starci/grammar*`).
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import type * as Ts from "typescript"
import type Compiler from "typescript"
import { sourceRoots } from "../v0540/index.mts"

/** The Sparkline props 0.57.1 deletes. */
export const DELETED_PROPS: readonly string[] = Object.freeze(["tone", "emptyLabel"])

export interface V0571Finding {
    readonly file: string
    readonly line: number
    readonly reason: string
    readonly before: string
}

export interface V0571Report {
    readonly codemod: "v0571"
    readonly version: "0.57.1"
    readonly mode: "dry" | "execute"
    readonly findings: readonly V0571Finding[]
    readonly files: readonly string[]
}

/** Every rewrite of v0571 over one source. */
export function transformSource(ts: typeof Compiler, file: string, original: string): { readonly text: string; readonly findings: readonly V0571Finding[] } {
    const sf = ts.createSourceFile(file, original, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const names = new Set<string>()
    const namespaces = new Set<string>()
    for (const st of sf.statements) {
        if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !st.moduleSpecifier.text.startsWith("@starci/grammar")) continue
        const bindings = st.importClause?.namedBindings
        if (bindings !== undefined && ts.isNamedImports(bindings)) {
            for (const spec of bindings.elements) if ((spec.propertyName ?? spec.name).text === "Sparkline") names.add(spec.name.text)
        }
        if (bindings !== undefined && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text)
    }
    const findings: V0571Finding[] = []
    if (names.size === 0 && namespaces.size === 0) return { text: original, findings }
    const cuts: { readonly pos: number; readonly end: number }[] = []
    const isSparkline = (tag: Ts.Node): boolean =>
        (ts.isIdentifier(tag) && names.has(tag.text)) || (ts.isPropertyAccessExpression(tag) && ts.isIdentifier(tag.expression) && namespaces.has(tag.expression.text) && tag.name.text === "Sparkline")
    const visit = (n: Ts.Node): void => {
        if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && isSparkline(n.tagName)) {
            for (const attr of n.attributes.properties) {
                if (!ts.isJsxAttribute(attr) || !DELETED_PROPS.includes(attr.name.getText(sf))) continue
                cuts.push({ pos: attr.getFullStart(), end: attr.getEnd() })
                findings.push({ file, line: sf.getLineAndCharacterOfPosition(attr.getStart(sf)).line + 1, reason: `Sparkline ${attr.name.getText(sf)} is deleted in 0.57.1; dropped`, before: attr.getText(sf) })
            }
        }
        ts.forEachChild(n, visit)
    }
    visit(sf)
    let text = original
    for (const cut of cuts.sort((a, b) => b.pos - a.pos)) text = text.slice(0, cut.pos) + text.slice(cut.end)
    return { text, findings }
}

const SKIP = new Set(["node_modules", ".next", "dist", "build", "out", "coverage", ".git"])

const walk = (dir: string, out: string[]): void => {
    for (const name of readdirSync(dir)) {
        if (SKIP.has(name)) continue
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p, out)
        else if (/\.tsx$/.test(name)) out.push(p)
    }
}

/** Run v0571 over an app checkout's front-end sources. Dry unless `write`. */
export function runV0571({ root, write, ts }: { readonly root: string; readonly write: boolean; readonly ts: typeof Compiler }): V0571Report {
    const all: string[] = []
    for (const dir of sourceRoots(root)) walk(dir, all)
    const findings: V0571Finding[] = []
    const files: string[] = []
    for (const path of all.sort()) {
        const rel = relative(root, path).replaceAll("\\", "/")
        const original = readFileSync(path, "utf8")
        const result = transformSource(ts, rel, original)
        if (result.findings.length === 0) continue
        findings.push(...result.findings)
        files.push(rel)
        if (write && result.text !== original) writeFileSync(path, result.text)
    }
    return { codemod: "v0571", version: "0.57.1", mode: write ? "execute" : "dry", findings, files }
}

/** The report as Markdown. */
export function v0571Markdown(report: V0571Report): string {
    const lines = [`# starci app codemod v0571 (Grammar ${report.version}: the neutral Sparkline), ${report.mode}`, ""]
    lines.push(`${String(report.findings.length)} props dropped in ${String(report.files.length)} files (Sparkline tone and emptyLabel are deleted).`, "")
    if (report.findings.length) lines.push(...report.findings.map((f) => `- ${f.file}:${String(f.line)} ${f.reason}: \`${f.before.replaceAll("`", "'")}\``), "")
    return `${lines.join("\n")}\n`
}
