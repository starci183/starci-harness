/**
 * v0551: the codemod of Grammar 0.55.1. The graph ext opens at 100% on every screen (owner: "size vẫn vậy chỉ có điều kéo = tay thôi"), so its phone switch
 * is deleted: `shared.PHONE_WIDTH` and `shared.usePhone` of `@starci/grammar/core/ext/graph`. There is nothing to rewrite them to (a graph no longer differs
 * on a phone), so each use is marked `// TODO(grammar-0.55.1): <what to do>` and listed. The initial focus is the new optional `focusId` prop.
 * `AlertAction.icon` is deleted too (a banner's buttons take its tint and none carries a start icon): the `icon` key of a Grammar `<Alert action>` is dropped.
 * Additions of 0.55.1 (`focusId`, the ext BarChart's `highlightLast`) need no codemod; the fixed v0550 is re-run in place (`starci app codemod v0550`).
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
function markGraphPhone(ts: typeof Compiler, file: string, original: string): { readonly text: string; readonly findings: readonly V0551Finding[] } {
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

/**
 * `AlertAction.icon` is deleted in 0.55.1 (owner 2026-11-23: a button in a banner takes the banner's tint and none is primary, so none carries a start icon).
 * Drop the `icon` key from the object literal of an `action` attribute on a Grammar `<Alert>` (a named import, an alias, or `X.Alert` of a namespace import
 * of `@starci/grammar*`), and list each drop. Any other element's `action` is left.
 */
export function dropAlertActionIcon(ts: typeof Compiler, file: string, original: string): { readonly text: string; readonly findings: readonly V0551Finding[] } {
    const sf = ts.createSourceFile(file, original, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const alerts = new Set<string>()
    const namespaces = new Set<string>()
    for (const st of sf.statements) {
        if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !st.moduleSpecifier.text.startsWith("@starci/grammar")) continue
        const bindings = st.importClause?.namedBindings
        if (bindings !== undefined && ts.isNamedImports(bindings)) for (const spec of bindings.elements) if ((spec.propertyName ?? spec.name).text === "Alert") alerts.add(spec.name.text)
        if (bindings !== undefined && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text)
    }
    const findings: V0551Finding[] = []
    if (alerts.size === 0 && namespaces.size === 0) return { text: original, findings }
    const isAlert = (tag: Ts.JsxTagNameExpression): boolean =>
        (ts.isIdentifier(tag) && alerts.has(tag.text)) || (ts.isPropertyAccessExpression(tag) && ts.isIdentifier(tag.expression) && namespaces.has(tag.expression.text) && tag.name.text === "Alert")
    const cuts: { start: number; end: number }[] = []
    const visit = (n: Ts.Node): void => {
        if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && isAlert(n.tagName)) {
            for (const attr of n.attributes.properties) {
                if (!ts.isJsxAttribute(attr) || attr.name.getText(sf) !== "action" || attr.initializer === undefined || !ts.isJsxExpression(attr.initializer)) continue
                const object = attr.initializer.expression
                if (object === undefined || !ts.isObjectLiteralExpression(object)) continue
                const props = object.properties
                props.forEach((prop, index) => {
                    if (prop.name === undefined || prop.name.getText(sf) !== "icon") return
                    const next = props[index + 1]
                    const previous = props[index - 1]
                    cuts.push(next !== undefined ? { start: prop.getStart(sf), end: next.getStart(sf) } : previous !== undefined ? { start: previous.end, end: prop.end } : { start: prop.getStart(sf), end: prop.end })
                    findings.push({ file, line: sf.getLineAndCharacterOfPosition(prop.getStart(sf)).line + 1, reason: "Alert action.icon is deleted in 0.55.1 (a banner's buttons take its tint and carry no start icon); dropped", before: prop.getText(sf).slice(0, 120) })
                })
            }
        }
        ts.forEachChild(n, visit)
    }
    visit(sf)
    let text = original
    for (const cut of [...cuts].sort((a, b) => b.start - a.start)) text = text.slice(0, cut.start) + text.slice(cut.end)
    return { text, findings }
}

/** Every rewrite of v0551 over one source: the graph's deleted phone members are marked, an Alert action's deleted `icon` is dropped. */
export function transformSource(ts: typeof Compiler, file: string, original: string): { readonly text: string; readonly findings: readonly V0551Finding[] } {
    const graph = markGraphPhone(ts, file, original)
    const alert = dropAlertActionIcon(ts, file, graph.text)
    return { text: alert.text, findings: [...graph.findings, ...alert.findings] }
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
    const lines = [`# starci app codemod v0551 (Grammar ${report.version}: the graph opens at 100% on every screen, an Alert action has no icon), ${report.mode}`, ""]
    lines.push(`${String(report.findings.length)} uses of a deleted 0.55.1 API in ${String(report.files.length)} files (graph members marked \`${MARK}\`, an Alert action's icon dropped).`, "")
    if (report.findings.length) lines.push(...report.findings.map((f) => `- ${f.file}:${String(f.line)} ${f.reason}: \`${f.before.replaceAll("`", "'")}\``), "")
    return `${lines.join("\n")}\n`
}
