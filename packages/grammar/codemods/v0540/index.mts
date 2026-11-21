/**
 * v0540: the codemod of Grammar 0.54.0, the type roles (owner 2026-11-21). It moves raw type sizes onto the roles:
 *
 *   - a class string with a Tailwind text-size utility (`text-sm font-medium`) becomes the class of its role
 *     (`starci-type-label-item`), keeping the other utilities;
 *   - a Grammar `<Text size isStrong mono tone>` becomes `<Text role="…">`.
 *
 * Anything it cannot decide is left as it was, marked in source with `// TODO(type-role): <reason>` and listed in the report.
 * The TypeScript compiler is handed in by the caller (the app's own install), so the Grammar package takes no runtime dependency.
 * Ported from the NIVO type-roles lane codemod; the decision table is MAPPING below.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs"
import { join, relative } from "node:path"
import type * as Ts from "typescript"
import type Compiler from "typescript"

/** The marker an ambiguous case gets in source. */
export const MARK = "TODO(type-role)"

/**
 * The ten roles of Grammar 0.54.0, in the owner's order. A mirror of `TEXT_ROLES` (src/common/typeRoles.ts): the codemod ships
 * standalone in dist/codemods, and its spec holds the two in step.
 */
export const ROLES = Object.freeze(["figure", "title.page", "title.section", "label.item", "body", "label.field", "label.group", "caption", "badge", "code"] as const)
export type Role = (typeof ROLES)[number]

/** The public class of a role, dots as dashes: the mirror of `typeRoleClassName`. */
export const roleClass = (role: Role): string => `starci-type-${role.replace(".", "-")}`

/** The decision table, kept as data so the report and the codemod cannot drift. */
export const MAPPING: readonly { readonly when: string; readonly role: Role }[] = [
    { when: "text-xs + font-mono", role: "code" },
    { when: "text-xs + weight>=500 + text-muted", role: "label.group" },
    { when: "text-xs + text-muted (weight 400)", role: "caption" },
    { when: "text-sm|[13px] + weight>=500 + text-muted on <label>", role: "label.field" },
    { when: "text-sm + weight>=500 (not muted)", role: "label.item" },
    { when: "text-sm alone (text-muted kept as colour)", role: "body" },
    { when: "text-base|lg + weight>=500 in h2-h6", role: "title.section" },
    { when: "text-xl|2xl in h1", role: "title.page" },
    { when: "text-xl|2xl + tabular-nums", role: "figure" },
    { when: "<Text size=xs> + isStrong", role: "label.group" },
    { when: "<Text size=xs>", role: "caption" },
    { when: "<Text size=sm|md|default> + isStrong (not muted)", role: "label.item" },
    { when: "<Text size=sm|md|default> (tone kept)", role: "body" },
    { when: "<Text size=figure>", role: "figure" },
    { when: "<Text size=xs mono>", role: "code" },
]

const SIZE_RE = /^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|\[\d+(?:\.\d+)?(?:px|rem)\])$/
const VARIANT_SIZE_RE = /^\S+:text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|\[\d+(?:\.\d+)?(?:px|rem)\])$/
const STRONG_RE = /^font-(medium|semibold|bold|extrabold)$/
const LEADING_RE = /^leading-/
const CLASS_FNS = new Set(["cn", "clsx", "cva", "twMerge", "tv", "classNames"])

/** One conversion or one case left for a person. */
export interface Finding {
    readonly file: string
    readonly line: number
    readonly kind: "class" | "text-prop"
    readonly role?: Role
    readonly reason?: string
    readonly before: string
    readonly after?: string
}

/** What one file came to. */
export interface FileSummary {
    readonly file: string
    readonly converted: number
    readonly todos: number
    readonly changed: boolean
}

/** The report of one run. */
export interface V0540Report {
    readonly codemod: "v0540"
    readonly version: "0.54.0"
    readonly mode: "dry" | "execute"
    readonly converted: number
    readonly perRole: Readonly<Record<string, number>>
    readonly files: readonly FileSummary[]
    /** The cases left for a person, each marked `TODO(type-role)` in source. */
    readonly findings: readonly Finding[]
}

interface Edit {
    readonly pos: number
    readonly end: number
    readonly text: string
}

type Mapped = { readonly role: Role; readonly out: string } | { readonly ambiguous: string } | null

/** Resolve one class list: a role and the rewritten list, an ambiguity, or null when it holds no raw size. */
export function mapClassList(list: string, tag: string | null): Mapped {
    const tokens = list.split(/\s+/).filter(Boolean)
    const sizes = tokens.filter((t) => SIZE_RE.test(t))
    const variantSizes = tokens.filter((t) => VARIANT_SIZE_RE.test(t))
    if (sizes.length === 0 && variantSizes.length === 0) return null
    if (variantSizes.length > 0) return { ambiguous: "responsive or state size variant" }
    if (sizes.length > 1) return { ambiguous: "more than one size" }
    const size = (sizes[0] ?? "").slice(5)
    const strong = tokens.some((t) => STRONG_RE.test(t))
    const odd = tokens.find((t) => /^font-(thin|extralight|light|black)$/.test(t) || t.startsWith("tracking-"))
    if (odd !== undefined) return { ambiguous: `uses ${odd}` }
    const muted = tokens.includes("text-muted")
    const mono = tokens.includes("font-mono")
    const tabular = tokens.includes("tabular-nums")
    const heading = tag !== null && /^h[1-6]$/.test(tag)
    const hasBox = tokens.some((t) => t.startsWith("rounded")) && tokens.some((t) => t.startsWith("bg-"))
    let role: Role
    let keepMuted = false
    if (mono && (size === "xs" || size === "[12px]")) role = "code"
    else if (mono) return { ambiguous: "mono above 12px" }
    else if (size === "xs" || size === "[12px]" || size === "[11px]") {
        if (hasBox) return { ambiguous: "xs on a filled pill: badge or caption" }
        if (strong && muted) role = "label.group"
        else if (muted) role = "caption"
        else return { ambiguous: strong ? "xs strong without muted: label.group or badge" : "xs without muted: caption or badge" }
    } else if (size === "sm" || size === "[13px]" || size === "[14px]") {
        if (heading) return { ambiguous: "sm inside a heading" }
        if (strong && muted) {
            if (tag === "label") role = "label.field"
            else return { ambiguous: "sm muted strong outside a <label>: label.field or label.item" }
        } else if (size === "[13px]") return { ambiguous: "13px outside a muted strong label" }
        else if (strong) role = "label.item"
        else {
            role = "body"
            keepMuted = muted
        }
    } else if (size === "base" || size === "lg" || /^\[1[5-8]px\]$/.test(size)) {
        if (heading && tag !== "h1" && strong) role = "title.section"
        else return { ambiguous: heading ? "16-18px heading without weight, or an h1" : "16-18px outside a heading" }
    } else if (size === "xl" || size === "2xl") {
        if (tag === "h1") role = "title.page"
        else if (tabular) role = "figure"
        else return { ambiguous: "xl/2xl that is neither an h1 nor a tabular figure" }
    } else return { ambiguous: "display size above 2xl" }
    // These roles own their weight; a muted one is not defined, so it stays a separate decision.
    if ((role === "title.section" || role === "title.page" || role === "figure") && muted) return { ambiguous: `${role} with muted colour` }
    const impliesMuted = role === "caption" || role === "label.group" || role === "label.field"
    const kept = tokens.filter((t) => {
        if (SIZE_RE.test(t) || STRONG_RE.test(t) || LEADING_RE.test(t) || t === "font-normal" || t === "font-mono") return false
        return !(t === "text-muted" && (impliesMuted || !keepMuted))
    })
    return { role, out: [roleClass(role), ...kept].join(" ") }
}

/** Rewrite one source text. Returns the new text and what it found; `file` names it in the findings. */
export function transformSource(ts: typeof Compiler, file: string, original: string): { readonly text: string; readonly findings: readonly Finding[] } {
    const findings: Finding[] = []
    const sf = ts.createSourceFile(file, original, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const edits: Edit[] = []
    const marked = new Set<Ts.Node>()
    const lineOf = (pos: number): number => sf.getLineAndCharacterOfPosition(pos).line + 1
    const jsxTagName = (node: Ts.Node): string | null => {
        for (let p: Ts.Node | undefined = node; p; p = p.parent) {
            if (ts.isJsxOpeningElement(p) || ts.isJsxSelfClosingElement(p)) return p.tagName.getText(sf)
        }
        return null
    }
    /** The nearest scope judged as a whole: a cn()/clsx() call, else the node itself. */
    const classScope = (node: Ts.Node): Ts.Node => {
        for (let p: Ts.Node | undefined = node.parent; p; p = p.parent) {
            if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && CLASS_FNS.has(p.expression.text)) return p
            if (ts.isJsxAttribute(p) || ts.isStatement(p)) return node
        }
        return node
    }
    const literalsIn = (node: Ts.Node): Ts.Node[] => {
        const found: Ts.Node[] = []
        const visit = (n: Ts.Node): void => {
            if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) found.push(n)
            ts.forEachChild(n, visit)
        }
        visit(node)
        return found
    }
    const staticText = (n: Ts.Node): string | null => (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ? n.text : null)
    /** The marker on its own line above the nearest statement, property or attribute of `node`. */
    const mark = (node: Ts.Node, reason: string): void => {
        if (marked.has(node)) return
        let target: Ts.Node = node
        while (target.parent && !ts.isStatement(target) && !ts.isPropertyAssignment(target) && !ts.isJsxAttribute(target) && !ts.isArrayLiteralExpression(target.parent)) target = target.parent
        const start = target.getStart(sf)
        if (sf.text.slice(Math.max(0, start - 160), start).includes(MARK)) return
        marked.add(node)
        const lineStart = sf.text.lastIndexOf("\n", start - 1) + 1
        const lead = sf.text.slice(lineStart, start)
        const indent = /^\s*/.exec(lead)?.[0] ?? ""
        edits.push(lead.trim() === "" ? { pos: start, end: start, text: `// ${MARK}: ${reason}\n${indent}` } : { pos: start, end: start, text: `/* ${MARK}: ${reason} */ ` })
    }

    const classLiteral = (lit: Ts.Node): void => {
        if (ts.isTemplateExpression(lit)) {
            const all = [lit.head.text, ...lit.templateSpans.map((s) => s.literal.text)].join(" ")
            if (all.split(/\s+/).some((t) => SIZE_RE.test(t))) {
                findings.push({ file, line: lineOf(lit.getStart(sf)), kind: "class", reason: "dynamic template literal", before: lit.getText(sf).slice(0, 120) })
                mark(lit, "dynamic template literal")
            }
            return
        }
        const text = staticText(lit)
        if (text === null) return
        const scopeNode = classScope(lit)
        let res = mapClassList(text, jsxTagName(lit))
        if (res === null) return
        if (!("ambiguous" in res) && scopeNode !== lit) {
            const clash = literalsIn(scopeNode).filter((n) => n !== lit).some((n) => {
                const s = staticText(n)
                return s !== null && s.split(/\s+/).some((t) => STRONG_RE.test(t) || t === "text-muted" || t === "font-mono" || LEADING_RE.test(t) || SIZE_RE.test(t) || VARIANT_SIZE_RE.test(t))
            })
            if (clash) res = { ambiguous: "size and its neighbours split across cn() arguments" }
        }
        const line = lineOf(lit.getStart(sf))
        if ("ambiguous" in res) {
            findings.push({ file, line, kind: "class", reason: res.ambiguous, before: text })
            // A JSX attribute takes its marker between attributes, any other literal above its statement.
            mark(ts.findAncestor(lit, ts.isJsxAttribute) ?? lit, res.ambiguous)
            return
        }
        const quote = sf.text[lit.getStart(sf)] ?? "\""
        edits.push({ pos: lit.getStart(sf) + 1, end: lit.getEnd() - 1, text: res.out.replaceAll(quote, `\\${quote}`) })
        findings.push({ file, line, kind: "class", role: res.role, before: text, after: res.out })
    }

    const textProp = (el: Ts.JsxOpeningElement | Ts.JsxSelfClosingElement): void => {
        const attrs = el.attributes.properties
        const find = (name: string): Ts.JsxAttribute | undefined => attrs.find((a): a is Ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText(sf) === name)
        if (find("role")) return
        const size = find("size")
        const tone = find("tone")
        const strong = find("isStrong")
        const mono = find("mono")
        // Nothing to translate: Grammar's default Text is already the body line.
        if (!size && !strong && !mono) return
        const lit = (a: Ts.JsxAttribute | undefined): string | true | null | undefined => {
            if (!a) return undefined
            if (!a.initializer) return true
            if (ts.isStringLiteral(a.initializer)) return a.initializer.text
            if (ts.isJsxExpression(a.initializer) && a.initializer.expression) {
                const x = a.initializer.expression
                if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) return x.text
                if (x.kind === ts.SyntaxKind.TrueKeyword) return true
                if (x.kind === ts.SyntaxKind.FalseKeyword) return undefined
            }
            return null
        }
        const sizeV = lit(size)
        const toneV = lit(tone)
        const strongV = lit(strong)
        const monoV = lit(mono)
        const line = lineOf(el.getStart(sf))
        const before = (el.getText(sf).split("\n")[0] ?? "").slice(0, 120)
        const fail = (reason: string): void => {
            findings.push({ file, line, kind: "text-prop", reason, before })
            if (el.getText(sf).includes(MARK)) return
            const lineStart = sf.text.lastIndexOf("\n", el.getStart(sf) - 1) + 1
            const indent = /^\s*/.exec(sf.text.slice(lineStart, el.getStart(sf)))?.[0] ?? ""
            edits.push({ pos: el.tagName.getEnd(), end: el.tagName.getEnd(), text: ` // ${MARK}: ${reason}\n${indent}    ` })
        }
        if (attrs.some((a) => ts.isJsxSpreadAttribute(a))) return fail("spread props")
        if (sizeV === null || strongV === null || monoV === null) return fail("non-literal size, isStrong or mono")
        const s = sizeV === undefined ? "md" : String(sizeV)
        let role: Role
        let dropTone = false
        if (s === "figure") role = "figure"
        else if (s === "xs") {
            role = monoV ? "code" : strongV ? "label.group" : "caption"
            dropTone = role !== "code"
        } else if (s === "sm" || s === "md") {
            if (monoV) return fail("mono at 14px: code is 12px")
            if (strongV && toneV !== undefined && toneV !== "default") return fail("muted or dynamic-tone strong 14px: label.field or label.item")
            role = strongV ? "label.item" : "body"
        } else return fail(`unknown size ${s}`)
        const drop = new Set<Ts.JsxAttribute>()
        for (const a of [size, strong, mono]) if (a) drop.add(a)
        if (dropTone && tone) drop.add(tone)
        if (role === "figure" && strong) drop.delete(strong)
        const ordered = [...drop].sort((a, b) => a.getStart(sf) - b.getStart(sf))
        const first = ordered[0]
        for (const a of ordered) {
            // The first dropped attribute becomes the role; the others go with their leading whitespace.
            if (a === first) edits.push({ pos: a.getStart(sf), end: a.getEnd(), text: `role="${role}"` })
            else edits.push({ pos: a.getFullStart(), end: a.getEnd(), text: "" })
        }
        if (!first) edits.push({ pos: el.tagName.getEnd(), end: el.tagName.getEnd(), text: ` role="${role}"` })
        findings.push({ file, line, kind: "text-prop", role, before, after: `role="${role}"` })
    }

    const visit = (n: Ts.Node): void => {
        if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText(sf) === "Text") textProp(n)
        if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) {
            const parent = n.parent
            const classPlace = ts.isJsxAttribute(parent) ? parent.name.getText(sf) === "className" : !ts.isImportDeclaration(parent) && !ts.isExportDeclaration(parent)
            if (classPlace) classLiteral(n)
        }
        if (ts.isTemplateExpression(n)) n.templateSpans.forEach((sp) => ts.forEachChild(sp.expression, visit))
        else ts.forEachChild(n, visit)
    }
    visit(sf)
    // A dropped attribute can overlap a marker: in position order, an overlapping edit is skipped.
    edits.sort((a, b) => a.pos - b.pos || a.end - b.end)
    let text = ""
    let cursor = 0
    for (const e of edits) {
        if (e.pos < cursor) continue
        text += original.slice(cursor, e.pos) + e.text
        cursor = e.end
    }
    text += original.slice(cursor)
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

/** The front-end source folders of an app checkout: `src` of every app and workspace package, on either layout (root or `fe/`), the app's gallery workspace, and a package's own `src`. */
export function sourceRoots(root: string): string[] {
    const roots: string[] = []
    for (const own of [join(root, "src"), join(root, "gallery", "src")]) if (existsSync(own) && statSync(own).isDirectory()) roots.push(own)
    for (const base of [root, join(root, "fe")]) {
        for (const group of ["apps", "packages"]) {
            const dir = join(base, group)
            if (!existsSync(dir)) continue
            for (const name of readdirSync(dir)) {
                const src = join(dir, name, "src")
                if (existsSync(src) && statSync(src).isDirectory()) roots.push(src)
            }
        }
    }
    return roots
}

/** Run v0540 over an app checkout. Dry unless `write`. */
export function runV0540({ root, write, ts }: { readonly root: string; readonly write: boolean; readonly ts: typeof Compiler }): V0540Report {
    const files: string[] = []
    for (const dir of sourceRoots(root)) walk(dir, files)
    const summaries: FileSummary[] = []
    const left: Finding[] = []
    const perRole: Record<string, number> = {}
    let converted = 0
    for (const path of files.sort()) {
        const rel = relative(root, path).replaceAll("\\", "/")
        const original = readFileSync(path, "utf8")
        const { text, findings } = transformSource(ts, rel, original)
        if (findings.length === 0) continue
        const done = findings.filter((f) => f.role !== undefined)
        for (const f of done) perRole[f.role as string] = (perRole[f.role as string] ?? 0) + 1
        converted += done.length
        left.push(...findings.filter((f) => f.role === undefined))
        summaries.push({ file: rel, converted: done.length, todos: findings.length - done.length, changed: text !== original })
        if (write && text !== original) writeFileSync(path, text)
    }
    return { codemod: "v0540", version: "0.54.0", mode: write ? "execute" : "dry", converted, perRole, files: summaries, findings: left }
}

/** The report as Markdown: the per-file summary, the conversions per role and every case left for a person. */
export function v0540Markdown(report: V0540Report): string {
    const lines = [`# starci app codemod v0540 (Grammar ${report.version}: the type roles), ${report.mode}`, ""]
    lines.push(`${String(report.converted)} conversions in ${String(report.files.length)} files; ${String(report.findings.length)} cases left for a person, marked \`${MARK}\`.`, "")
    if (Object.keys(report.perRole).length) lines.push("| Role | Conversions |", "| --- | --- |", ...Object.entries(report.perRole).map(([role, count]) => `| ${role} | ${String(count)} |`), "")
    if (report.files.length) lines.push("| File | Converted | TODO | Changed |", "| --- | --- | --- | --- |", ...report.files.map((f) => `| ${f.file} | ${String(f.converted)} | ${String(f.todos)} | ${f.changed ? (report.mode === "execute" ? "written" : "would change") : "no"} |`), "")
    if (report.findings.length) lines.push(`## ${MARK}`, "", ...report.findings.map((f) => `- ${f.file}:${String(f.line)} ${f.reason ?? ""}: \`${f.before.replaceAll("`", "'")}\``), "")
    return `${lines.join("\n")}\n`
}
