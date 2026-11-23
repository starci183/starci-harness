/**
 * v0551: the codemod of Grammar 0.55.1. The graph ext lays itself out top-down on a phone and opens fitted (the routing law), so its exported phone switch
 * is deleted: `shared.PHONE_WIDTH` and `shared.usePhone` of `@starci/grammar/core/ext/graph`. There is nothing to rewrite them to (a graph no longer differs
 * on a phone), so each use is marked `// TODO(grammar-0.55.1): <what to do>` and listed. The initial focus is the new optional `focusId` prop.
 * Additions of 0.55.1 (`focusId`, the ext BarChart's `highlightLast`) need no codemod; the fixed v0550 is re-run in place (`starci app codemod v0550`).
 *
 * `MermaidDiagram` moved to the graph ext (owner 2026-11-23: every diagram on the graph canvas): its import from a core entry (`@starci/grammar/core`,
 * `/common`, `/offset-pop`) is rewritten to `@starci/grammar/core/ext/graph`, with its types; a use through a namespace import is marked. A
 * `Markdown` whose body carries `mermaid` fences draws them only with its new `renderDiagram` slot: that is the app's to add (the changelog says how).
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import type * as Ts from "typescript"
import type Compiler from "typescript"
import { sourceRoots } from "../v0540/index.mts"

/** The marker of a case left for a person. */
export const MARK = "TODO(grammar-0.55.1)"

/** The graph module whose `shared` namespace lost the members. */
export const GRAPH_MODULE = "@starci/grammar/core/ext/graph"

/** The core entries `MermaidDiagram` left. */
export const CORE_ENTRIES: readonly string[] = Object.freeze(["@starci/grammar/core", "@starci/grammar/common", "@starci/grammar/offset-pop"])

/** The exports that moved from the core entries to the graph ext in 0.55.1. */
export const MOVED_TO_GRAPH: readonly string[] = Object.freeze(["MermaidDiagram", "MermaidDiagramHeight", "MermaidDiagramProps", "MermaidTone"])

/** The members of `shared` deleted in 0.55.1, and what to do instead. */
export const DELETED_SHARED: Readonly<Record<string, string>> = Object.freeze({
    PHONE_WIDTH: "nothing: a graph lays itself out top-down under 480px and opens fitted; keep a phone breakpoint of the app's own if the page needs one",
    usePhone: "nothing: a graph lays itself out top-down under 480px and opens fitted (the routing law)",
})

export interface V0551Finding {
    readonly file: string
    readonly line: number
    readonly reason: string
    readonly before: string
    /** What the line became, for a rewrite the codemod made itself. */
    readonly after?: string
}

interface Edit {
    readonly pos: number
    readonly end: number
    readonly text: string
}

/** Moves `MermaidDiagram` and its types out of a core entry's import into an import of the graph ext; a namespace import is returned for marking. */
const moveDiagramImports = (ts: typeof Compiler, sf: Ts.SourceFile, file: string, lineOf: (pos: number) => number): { readonly edits: readonly Edit[]; readonly findings: readonly V0551Finding[]; readonly namespaces: ReadonlySet<string> } => {
    const edits: Edit[] = []
    const findings: V0551Finding[] = []
    const namespaces = new Set<string>()
    for (const st of sf.statements) {
        if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !CORE_ENTRIES.includes(st.moduleSpecifier.text)) continue
        const bindings = st.importClause?.namedBindings
        if (bindings !== undefined && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text)
        if (bindings === undefined || !ts.isNamedImports(bindings)) continue
        const moved = bindings.elements.filter((spec) => MOVED_TO_GRAPH.includes((spec.propertyName ?? spec.name).text))
        if (moved.length === 0) continue
        const quote = sf.text[st.moduleSpecifier.getStart(sf)] ?? '"'
        const typeOnly = st.importClause?.isTypeOnly === true
        const line = (specs: readonly Ts.ImportSpecifier[], module: string): string => `import ${typeOnly ? "type " : ""}{ ${specs.map((spec) => spec.getText(sf)).join(", ")} } from ${quote}${module}${quote}`
        const kept = bindings.elements.filter((spec) => !moved.includes(spec))
        const semi = st.getText(sf).trimEnd().endsWith(";") ? ";" : ""
        const head = st.importClause?.name === undefined ? "" : `import ${st.importClause.name.text} from ${quote}${st.moduleSpecifier.text}${quote}${semi}\n`
        const lines = [...(kept.length > 0 ? [line(kept, st.moduleSpecifier.text)] : []), line(moved, GRAPH_MODULE)]
        edits.push({ pos: st.getStart(sf), end: st.getEnd(), text: head + lines.map((each) => `${each}${semi}`).join("\n") })
        findings.push({ file, line: lineOf(st.getStart(sf)), reason: "MermaidDiagram moved to the graph ext in 0.55.1 (import @starci/grammar/core/ext/graph.css once)", before: st.getText(sf).slice(0, 120), after: `${moved.map((spec) => spec.name.text).join(", ")} from ${GRAPH_MODULE}` })
    }
    return { edits, findings, namespaces }
}

/** Why a namespace use of `MermaidDiagram` is marked. */
export const DIAGRAM_REASON = `MermaidDiagram is no longer in the core entries in 0.55.1; import { MermaidDiagram } from "${GRAPH_MODULE}" and its stylesheet once`

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
    const lineOf = (pos: number): number => sf.getLineAndCharacterOfPosition(pos).line + 1
    const diagram = moveDiagramImports(ts, sf, file, lineOf)
    const names = new Set<string>()
    for (const st of sf.statements) {
        if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || st.moduleSpecifier.text !== GRAPH_MODULE) continue
        const bindings = st.importClause?.namedBindings
        if (bindings !== undefined && ts.isNamedImports(bindings)) for (const spec of bindings.elements) if ((spec.propertyName ?? spec.name).text === "shared") names.add(spec.name.text)
    }
    const findings: V0551Finding[] = [...diagram.findings]
    const inserts: { pos: number; text: string }[] = []
    if (names.size === 0 && diagram.edits.length === 0 && diagram.namespaces.size === 0) return { text: original, findings }
    const mark = (node: Ts.Node, member: string, given?: string): void => {
        const reason = given ?? `shared.${member} is deleted in 0.55.1; use ${DELETED_SHARED[member] ?? ""}`
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
        if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && diagram.namespaces.has(n.expression.text) && n.name.text === "MermaidDiagram") mark(n, n.name.text, DIAGRAM_REASON)
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
    const all: Edit[] = [...diagram.edits, ...inserts.map((insert) => ({ pos: insert.pos, end: insert.pos, text: insert.text }))]
    for (const edit of all.sort((a, b) => b.pos - a.pos)) text = text.slice(0, edit.pos) + edit.text + text.slice(edit.end)
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
        const out = transformSource(ts, rel, original)
        if (out.findings.length === 0) continue
        findings.push(...out.findings)
        files.push(rel)
        if (write && out.text !== original) writeFileSync(path, out.text)
    }
    return { codemod: "v0551", version: "0.55.1", mode: write ? "execute" : "dry", findings, files }
}

/** The report as Markdown: every use of a deleted member, left for a person. */
export function v0551Markdown(report: V0551Report): string {
    const lines = [`# starci app codemod v0551 (Grammar ${report.version}: the graph lays itself out on a phone; MermaidDiagram on the graph canvas), ${report.mode}`, ""]
    lines.push(`${String(report.findings.length)} uses of a deleted graph member or a moved MermaidDiagram in ${String(report.files.length)} files; a rewrite shows its result, the rest are marked \`${MARK}\`.`, "")
    if (report.findings.length) lines.push(...report.findings.map((f) => `- ${f.file}:${String(f.line)} ${f.reason}: \`${f.before.replaceAll("`", "'")}\`${f.after === undefined ? "" : ` -> ${f.after}`}`), "")
    return `${lines.join("\n")}\n`
}
