/**
 * v0570: the codemod of Grammar 0.57.0, the icon table (owner 2026-11-23; contexts/ui/scale.md "The icon table").
 *
 * - Icon `usage` names a ROLE now, `text | control | row | head`: `chip` and `leading` become `control` (16, the one leading icon beside 14px
 *   words, every labelled button, a field, a navigation entry), `heading` becomes `head` (24, the glyph of the 48 head tile). Rewritten on a
 *   Grammar `<Icon usage="…">` (a named import, an alias or `X.Icon` of a namespace import of `@starci/grammar*`) and on a `usage: "…"` key of
 *   an object passed to such an element through a spread, and on `inlineGlyph(name, extra, "…")`.
 * - `Disclosure chevron` is deleted: the disclosure caret always stands before the label and turns 90 degrees when open (a caret after words
 *   means "goes elsewhere"). The attribute is dropped.
 * - `LogoStack` is deleted: a row of channel logos is an `AvatarGroup` of `kind: "logo"` items sized by `size`, a lone logo an
 *   `Avatar kind="logo"` of the same `size`. Each import and use is marked `// TODO(grammar-0.57.0): …` (the items change shape: `label` is
 *   `name`, `iconSource` has no logo equivalent, `overflowLabel` is required) and listed.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import type * as Ts from "typescript"
import type Compiler from "typescript"
import { sourceRoots } from "../v0540/index.mts"

/** The marker of a case left for a person. */
export const MARK = "TODO(grammar-0.57.0)"

/** The old Icon usages and the role each becomes. */
export const USAGE_RENAMES: Readonly<Record<string, string>> = Object.freeze({ chip: "control", leading: "control", heading: "head" })

/** Why a LogoStack is marked. */
export const LOGO_STACK_REASON = "LogoStack is deleted in 0.57.0; draw the logos as <AvatarGroup size=\"sm\" items={[{ id, name, src, kind: \"logo\" }]} overflowLabel={…} /> and a lone logo as <Avatar kind=\"logo\" size=\"sm\" />"

export interface V0570Finding {
    readonly file: string
    readonly line: number
    readonly reason: string
    readonly before: string
    /** What the code became, for a rewrite the codemod made itself. */
    readonly after?: string
}

export interface V0570Report {
    readonly codemod: "v0570"
    readonly version: "0.57.0"
    readonly mode: "dry" | "execute"
    readonly findings: readonly V0570Finding[]
    readonly files: readonly string[]
}

interface Edit {
    readonly pos: number
    readonly end: number
    readonly text: string
}

/** The local names a source binds to Grammar exports, and its namespace imports of Grammar. */
const grammarBindings = (ts: typeof Compiler, sf: Ts.SourceFile, wanted: readonly string[]): { readonly names: Map<string, string>; readonly namespaces: Set<string>; readonly imports: Ts.ImportDeclaration[] } => {
    const names = new Map<string, string>()
    const namespaces = new Set<string>()
    const imports: Ts.ImportDeclaration[] = []
    for (const st of sf.statements) {
        if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !st.moduleSpecifier.text.startsWith("@starci/grammar")) continue
        imports.push(st)
        const bindings = st.importClause?.namedBindings
        if (bindings !== undefined && ts.isNamedImports(bindings)) {
            for (const spec of bindings.elements) {
                const exported = (spec.propertyName ?? spec.name).text
                if (wanted.includes(exported)) names.set(spec.name.text, exported)
            }
        }
        if (bindings !== undefined && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text)
    }
    return { names, namespaces, imports }
}

/** Every rewrite of v0570 over one source. */
export function transformSource(ts: typeof Compiler, file: string, original: string): { readonly text: string; readonly findings: readonly V0570Finding[] } {
    const sf = ts.createSourceFile(file, original, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const lineOf = (pos: number): number => sf.getLineAndCharacterOfPosition(pos).line + 1
    const { names, namespaces, imports } = grammarBindings(ts, sf, ["Icon", "Disclosure", "LogoStack", "inlineGlyph"])
    const findings: V0570Finding[] = []
    if (names.size === 0 && namespaces.size === 0) return { text: original, findings }
    const edits: Edit[] = []
    const inserts: { pos: number; text: string }[] = []
    const which = (tag: Ts.Node): string | undefined => {
        if (ts.isIdentifier(tag)) return names.get(tag.text)
        if (ts.isPropertyAccessExpression(tag) && ts.isIdentifier(tag.expression) && namespaces.has(tag.expression.text)) return tag.name.text
        return undefined
    }
    const renameLiteral = (literal: Ts.StringLiteral, where: string): void => {
        const to = USAGE_RENAMES[literal.text]
        if (to === undefined) return
        const quote = original[literal.getStart(sf)] ?? '"'
        edits.push({ pos: literal.getStart(sf), end: literal.getEnd(), text: `${quote}${to}${quote}` })
        findings.push({ file, line: lineOf(literal.getStart(sf)), reason: `Icon usage "${literal.text}" is the ${to} role in 0.57.0 (${where})`, before: literal.getText(sf), after: `"${to}"` })
    }
    const mark = (node: Ts.Node, reason: string): void => {
        let statement: Ts.Node = node
        while (statement.parent !== undefined && !ts.isSourceFile(statement.parent) && !ts.isBlock(statement.parent)) statement = statement.parent
        const start = statement.getStart(sf)
        findings.push({ file, line: lineOf(node.getStart(sf)), reason, before: statement.getText(sf).split("\n")[0]?.slice(0, 120) ?? "" })
        if (original.slice(Math.max(0, start - 400), start).includes(`${MARK}: ${reason}`) || inserts.some((insert) => insert.pos === start)) return
        const lineStart = original.lastIndexOf("\n", start - 1) + 1
        const indent = /^\s*/.exec(original.slice(lineStart, start))?.[0] ?? ""
        inserts.push({ pos: start, text: `// ${MARK}: ${reason}\n${indent}` })
    }
    for (const st of imports) {
        const bindings = st.importClause?.namedBindings
        if (bindings !== undefined && ts.isNamedImports(bindings) && bindings.elements.some((spec) => (spec.propertyName ?? spec.name).text === "LogoStack")) mark(st, LOGO_STACK_REASON)
    }
    const visit = (n: Ts.Node): void => {
        if (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) {
            const component = which(n.tagName)
            for (const attr of n.attributes.properties) {
                if (component === "Icon" && ts.isJsxAttribute(attr) && attr.name.getText(sf) === "usage" && attr.initializer !== undefined) {
                    if (ts.isStringLiteral(attr.initializer)) renameLiteral(attr.initializer, "<Icon usage>")
                    else if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression !== undefined && ts.isStringLiteral(attr.initializer.expression)) renameLiteral(attr.initializer.expression, "<Icon usage>")
                }
                if (component === "Disclosure" && ts.isJsxAttribute(attr) && attr.name.getText(sf) === "chevron") {
                    const start = attr.getFullStart()
                    edits.push({ pos: start, end: attr.getEnd(), text: "" })
                    findings.push({ file, line: lineOf(attr.getStart(sf)), reason: "Disclosure chevron is deleted in 0.57.0: the caret always stands before the label and turns when open; dropped", before: attr.getText(sf) })
                }
            }
            if (component === "LogoStack") mark(n, LOGO_STACK_REASON)
        }
        if (ts.isCallExpression(n) && which(n.expression) === "inlineGlyph") {
            const usage = n.arguments[2]
            if (usage !== undefined && ts.isStringLiteral(usage)) renameLiteral(usage, "inlineGlyph")
        }
        ts.forEachChild(n, visit)
    }
    visit(sf)
    let text = original
    const all: Edit[] = [...edits, ...inserts.map((insert) => ({ pos: insert.pos, end: insert.pos, text: insert.text }))]
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

/** Run v0570 over an app checkout's front-end sources. Dry unless `write`. */
export function runV0570({ root, write, ts }: { readonly root: string; readonly write: boolean; readonly ts: typeof Compiler }): V0570Report {
    const all: string[] = []
    for (const dir of sourceRoots(root)) walk(dir, all)
    const findings: V0570Finding[] = []
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
    return { codemod: "v0570", version: "0.57.0", mode: write ? "execute" : "dry", findings, files }
}

/** The report as Markdown. */
export function v0570Markdown(report: V0570Report): string {
    const lines = [`# starci app codemod v0570 (Grammar ${report.version}: the icon table, the leading disclosure caret, LogoStack deleted), ${report.mode}`, ""]
    lines.push(`${String(report.findings.length)} rewrites or marks in ${String(report.files.length)} files (Icon usages renamed to roles, Disclosure chevron dropped, LogoStack marked \`${MARK}\`).`, "")
    if (report.findings.length) lines.push(...report.findings.map((f) => `- ${f.file}:${String(f.line)} ${f.reason}: \`${f.before.replaceAll("`", "'")}\`${f.after === undefined ? "" : ` -> ${f.after}`}`), "")
    return `${lines.join("\n")}\n`
}
