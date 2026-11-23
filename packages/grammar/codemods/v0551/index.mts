/**
 * v0551: the codemod of Grammar 0.55.1. The graph ext opens at 100% on every screen (owner: "size vẫn vậy chỉ có điều kéo = tay thôi"), so its phone switch
 * is deleted: `shared.PHONE_WIDTH` and `shared.usePhone` of `@starci/grammar/core/ext/graph`. There is nothing to rewrite them to (a graph no longer differs
 * on a phone), so each use is marked `// TODO(grammar-0.55.1): <what to do>` and listed. The initial focus is the new optional `focusId` prop.
 * Additions of 0.55.1 (`focusId`, the ext BarChart's `highlightLast`) need no codemod; the fixed v0550 is re-run in place (`starci app codemod v0550`).
 * Second pass (`agent-tone.mts`): the dev line's agent tones are deleted for the tone slot; `tone="agent"` and `agentToneOf(x)` become the app's `agentTone(x)`.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import type * as Ts from "typescript"
import type Compiler from "typescript"
import { sourceRoots } from "../v0540/index.mts"
import { transformAgentTone } from "./agent-tone.mts"

/** The marker of a case left for a person. */
export const MARK = "TODO(grammar-0.55.1)"

/** The graph module whose `shared` namespace lost the members. */
export const GRAPH_MODULE = "@starci/grammar/core/ext/graph"

/** The members of `shared` deleted in 0.55.1, and what to do instead. */
export const DELETED_SHARED: Readonly<Record<string, string>> = Object.freeze({
    PHONE_WIDTH: "nothing: a graph is the same on every screen (100%, dragged by hand); keep a phone breakpoint of the app's own if the page needs one",
    usePhone: "nothing: a graph is the same on every screen (100%, dragged by hand); FlowGraph, ErdMap and KnowledgeMap take focusId for the step they open on",
})

export interface V0551Finding {
    readonly file: string
    readonly line: number
    readonly reason: string
    readonly before: string
}

export interface V0551Report {
    readonly codemod: "v0551"
    readonly version: "0.55.1"
    readonly mode: "dry" | "execute"
    readonly findings: readonly V0551Finding[]
    readonly files: readonly string[]
}

/** Mark every use of a deleted `shared` member in one source: `shared.usePhone`, an alias of `shared`, or a destructured `{ usePhone } = shared`. */
export function transformSource(ts: typeof Compiler, file: string, original: string): { readonly text: string; readonly findings: readonly V0551Finding[] } {
    const sf = ts.createSourceFile(file, original, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const names = new Set<string>()
    for (const st of sf.statements) {
        if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || st.moduleSpecifier.text !== GRAPH_MODULE) continue
        const bindings = st.importClause?.namedBindings
        if (bindings !== undefined && ts.isNamedImports(bindings)) for (const spec of bindings.elements) if ((spec.propertyName ?? spec.name).text === "shared") names.add(spec.name.text)
    }
    const findings: V0551Finding[] = []
    const inserts: { pos: number; text: string }[] = []
    if (names.size === 0) return { text: original, findings }
    const lineOf = (pos: number): number => sf.getLineAndCharacterOfPosition(pos).line + 1
    const mark = (node: Ts.Node, member: string): void => {
        const reason = `shared.${member} is deleted in 0.55.1; use ${DELETED_SHARED[member] ?? ""}`
        let statement: Ts.Node = node
        while (statement.parent !== undefined && !ts.isSourceFile(statement.parent) && !ts.isBlock(statement.parent)) statement = statement.parent
        const start = statement.getStart(sf)
        findings.push({ file, line: lineOf(node.getStart(sf)), reason, before: statement.getText(sf).split("\n")[0]?.slice(0, 120) ?? "" })
        if (original.slice(Math.max(0, start - 400), start).includes(`${MARK}: ${reason}`) || inserts.some((insert) => insert.pos === start && insert.text.includes(reason))) return
        const lineStart = original.lastIndexOf("\n", start - 1) + 1
        const indent = /^\s*/.exec(original.slice(lineStart, start))?.[0] ?? ""
        inserts.push({ pos: start, text: `// ${MARK}: ${reason}\n${indent}` })
    }
    const visit = (n: Ts.Node): void => {
        if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && names.has(n.expression.text) && DELETED_SHARED[n.name.text] !== undefined) mark(n, n.name.text)
        if (ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name) && n.initializer !== undefined && ts.isIdentifier(n.initializer) && names.has(n.initializer.text)) {
            for (const element of n.name.elements) {
                const member = (element.propertyName ?? element.name).getText(sf)
                if (DELETED_SHARED[member] !== undefined) mark(element, member)
            }
        }
        ts.forEachChild(n, visit)
    }
    visit(sf)
    let text = original
    for (const insert of [...inserts].sort((a, b) => b.pos - a.pos)) text = text.slice(0, insert.pos) + insert.text + text.slice(insert.pos)
    return { text, findings }
}

const SKIP = new Set(["node_modules", ".next", "dist", "build", "out", "coverage", ".git"])

const walk = (dir: string, out: string[]): void => {
    for (const name of readdirSync(dir)) {
        if (SKIP.has(name)) continue
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p, out)
        else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) out.push(p)
    }
}

/** Run v0551 over an app checkout's front-end sources. Dry unless `write`. */
export function runV0551({ root, write, ts }: { readonly root: string; readonly write: boolean; readonly ts: typeof Compiler }): V0551Report {
    const all: string[] = []
    for (const dir of sourceRoots(root)) walk(dir, all)
    const findings: V0551Finding[] = []
    const files: string[] = []
    for (const path of all.sort()) {
        const rel = relative(root, path).replaceAll("\\", "/")
        const original = readFileSync(path, "utf8")
        const graph = transformSource(ts, rel, original)
        const tones = transformAgentTone(ts, rel, graph.text)
        const found = [...graph.findings, ...tones.findings]
        if (found.length === 0) continue
        findings.push(...found)
        files.push(rel)
        if (write && tones.text !== original) writeFileSync(path, tones.text)
    }
    return { codemod: "v0551", version: "0.55.1", mode: write ? "execute" : "dry", findings, files }
}

/** The report as Markdown: every use of a deleted member, left for a person. */
export function v0551Markdown(report: V0551Report): string {
    const lines = [`# starci app codemod v0551 (Grammar ${report.version}: the graph opens at 100% on every screen; the agent tones become the app's tone slot), ${report.mode}`, ""]
    lines.push(`${String(report.findings.length)} uses of a deleted graph member or agent tone in ${String(report.files.length)} files, marked \`${MARK}\`.`, "")
    if (report.findings.length) lines.push(...report.findings.map((f) => `- ${f.file}:${String(f.line)} ${f.reason}: \`${f.before.replaceAll("`", "'")}\``), "")
    return `${lines.join("\n")}\n`
}
