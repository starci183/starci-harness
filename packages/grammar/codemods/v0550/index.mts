/**
 * v0550: the codemod of Grammar 0.55.0, the site group (owner 2026-11-21, "3. THÊM NHÓM", then "cook"). It moves the public marketing
 * site's raw type onto the roles, measured on the NIVO site (D:/starci-lanes/_display-roles/measure.md):
 *
 *   - display.hero (36 / 48, 40 / 54 from 48rem, 48 / 64 from 64rem), display.section (28 / 38, 32 / 44 from 64rem), display.figure
 *     (36 / 48, 48 / 64, 56 / 76), lead (16 / 26, 18 / 28 from 64rem) and title.card (18 / 28): a class string with a stepped display
 *     size (`text-[2.25rem] md:text-[3.25rem] lg:text-[4rem]`) becomes ONE role class, its breakpoints, leading and tracking dropped,
 *     because the role's tokens carry the steps;
 *   - every other raw size of the site goes to the existing role of its pixel size (16 / 500 is title.section, 15 and 16 / 400 are body,
 *     13 / 500 muted is label.field, a 12 pill is badge, …), and `<Text size="sm" isStrong tone="muted">` keeps its tone as label.item;
 *   - a product drawing (a component folder whose classes use a size under 12px: the scaled console the site draws) stays raw, except a
 *     stepped display or lead class in it;
 *   - a real ambiguity stays as it was, marked `// TODO(type-role): <reason>` and listed in the report; a v0540 marker above a literal
 *     this codemod now converts is removed.
 *
 * It reads only the site's files (`isSitePath`): the console has no display roles (`starci-grammar/site-type-role`), and v0540 owns it.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import type * as Ts from "typescript"
import type Compiler from "typescript"
import { MARK, mapClassList, sourceRoots } from "../v0540/index.mts"
import { API_MARK, API_STEPS, transformApiSource, type ApiFinding } from "./api.mts"

export { MARK, API_MARK, API_STEPS }

/**
 * The fifteen roles of Grammar 0.55.0: the ten of 0.54.0 and the site group. A mirror of `TEXT_ROLES` (src/common/typeRoles.ts): the
 * codemod ships standalone in dist/codemods, and its spec holds the two in step.
 */
export const ROLES = Object.freeze([
    "figure", "title.page", "title.section", "label.item", "body", "label.field", "label.group", "caption", "badge", "code",
    "display.hero", "display.section", "display.figure", "lead", "title.card",
] as const)
export type Role = (typeof ROLES)[number]

/** The site group: the mirror of `SITE_TEXT_ROLES`. */
export const SITE_ROLES: readonly Role[] = Object.freeze(["display.hero", "display.section", "display.figure", "lead", "title.card"])

/** The public class of a role, dots as dashes: the mirror of `typeRoleClassName`. */
export const roleClass = (role: Role): string => `starci-type-${role.replace(".", "-")}`

/**
 * True for a file of the public marketing site. No hfs slot marks the site yet (the proposed `fe.site`), so this reads the app's own
 * layout: the `(site)` or `(marketing)` route group, a component or feature owner named `Site…` or `Marketing…`, and `modules/site…`.
 * The mirror of `isSitePath` in @starci/eslint-grammar-core (src/lib/site-scope.ts).
 */
export const isSitePath = (file: string): boolean => {
    const path = file.replaceAll("\\", "/")
    if (/(?:^|\/)\((?:site|marketing)\)\//.test(path)) return true
    if (/(?:^|\/)src\/(?:components\/(?:blocks|frames|composites|branches|leaves)|features\/(?:pages|layouts|overlays))\/(?:Site|Marketing)[A-Z0-9][^/]*\//.test(path)) return true
    return /(?:^|\/)src\/modules\/(?:site|marketing)[^/]*\//.test(path)
}

/** The decision table, kept as data so the report and the codemod cannot drift. px are the 390 (base) size; "steps" are md:/lg:/xl: sizes. */
export const MAPPING: readonly { readonly when: string; readonly role: Role }[] = [
    { when: "500, base >= 24, a step to >= 36, on a span/b/strong or with tabular-nums or leading-none", role: "display.figure" },
    { when: "500, base >= 34 or a step to >= 52", role: "display.hero" },
    { when: "500, base 22-32 stepping to 28-48", role: "display.section" },
    { when: "400, base 16-18 stepping to 18-20, not a heading", role: "lead" },
    { when: "500, 18-20 with no step, 16-20 stepping to <= 20, or an h2-h6 20 stepping to 24", role: "title.card" },
    { when: "500, 16 with no step", role: "title.section" },
    { when: "500, 14-15 with no step", role: "label.item" },
    { when: "400, 14-16 with no step (the colour kept)", role: "body" },
    { when: "13 or 12 on a pill (rounded + fill or border)", role: "badge" },
    { when: "13 / 500 muted", role: "label.field" },
    { when: "13 / 500 not muted", role: "label.item" },
    { when: "13 / 400 muted, 12 / 400 muted", role: "caption" },
    { when: "13 / 400 not muted", role: "body" },
    { when: "12 / 500 muted", role: "label.group" },
    { when: "12 / 500 not muted", role: "badge" },
    { when: "<Text size=sm|md isStrong> with any tone (the tone kept)", role: "label.item" },
]

const STEPS: Readonly<Record<string, number>> = { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, "2xl": 24, "3xl": 30, "4xl": 36, "5xl": 48, "6xl": 60, "7xl": 72 }
const SIZE = "(xs|sm|base|lg|[2-7]?xl|\\[\\d*\\.?\\d+(?:px|rem)\\])"
const BASE_SIZE_RE = new RegExp(`^text-${SIZE}$`)
const STEP_SIZE_RE = new RegExp(`^(?:sm|md|lg|xl|2xl):text-${SIZE}$`)
const OTHER_SIZE_RE = new RegExp(`^\\S+:text-${SIZE}$`)
const WEIGHT_RE = /^font-(normal|medium|semibold|bold|extrabold)$/
const ODD_WEIGHT_RE = /^font-(thin|extralight|light|black)$/
/** Leading and tracking at any breakpoint: the role owns both. */
const OWNED_RE = /^(?:(?:sm|md|lg|xl|2xl):)?(?:leading|tracking)-/
const CLASS_FNS = new Set(["cn", "clsx", "cva", "twMerge", "tv", "classNames"])
const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"])
const FIGURE_TAGS = new Set(["span", "b", "strong", "data"])
/** The roles that draw their own (muted) colour: a `text-muted` beside them goes. */
const MUTED_ROLES: ReadonlySet<Role> = new Set(["label.field", "label.group", "caption"])

/** The px of one size step (`lg`, `[2.25rem]`, `[13px]`). */
export const pxOf = (step: string): number => {
    const named = STEPS[step]
    if (named !== undefined) return named
    const match = /^\[(\d*\.?\d+)(px|rem)\]$/.exec(step)
    if (match === null) return Number.NaN
    return match[2] === "rem" ? Number(match[1]) * 16 : Number(match[1])
}

/** The size of a size utility (`md:text-lg` is lg). */
const stepOf = (token: string): string => token.slice(token.indexOf("text-") + 5)

type Mapped = { readonly role: Role; readonly out: string } | { readonly ambiguous: string } | null

/** The role a site class list takes, from its 390 size, its steps, its weight and its element. */
const siteRole = (input: { readonly base: number; readonly top: number; readonly stepped: boolean; readonly medium: boolean; readonly muted: boolean; readonly pill: boolean; readonly tag: string | null; readonly tokens: readonly string[] }): Role | { readonly ambiguous: string } => {
    const { base, top, stepped, medium, muted, pill, tag, tokens } = input
    const heading = tag !== null && HEADINGS.has(tag)
    if (medium && base >= 24 && top >= 36 && (tokens.includes("tabular-nums") || tokens.includes("leading-none") || (tag !== null && FIGURE_TAGS.has(tag)))) return "display.figure"
    if (medium && (base >= 34 || top >= 52)) return "display.hero"
    if (medium && stepped && base >= 22 && base <= 32 && top >= 28 && top <= 48) return "display.section"
    if (!medium && stepped && base >= 16 && base <= 18 && top >= 18 && top <= 20 && !heading) return "lead"
    if (medium && ((!stepped && base >= 18 && base <= 20) || (stepped && base >= 16 && base <= 20 && top <= 20) || (stepped && base === 20 && top === 24 && heading && tag !== "h1"))) return "title.card"
    if (stepped) return { ambiguous: `a ${String(base)}px size stepping to ${String(top)}px outside the site roles` }
    if (base === 16) return medium ? "title.section" : "body"
    if (base === 14 || base === 15) {
        if (medium && muted && tag === "label") return "label.field"
        return medium ? "label.item" : "body"
    }
    if (base === 13) {
        if (pill) return "badge"
        if (medium) return muted ? "label.field" : "label.item"
        return muted ? "caption" : "body"
    }
    if (base === 12) {
        if (pill) return "badge"
        if (medium) return muted ? "label.group" : "badge"
        return muted ? "caption" : { ambiguous: "12px not muted: caption would mute it" }
    }
    if (base < 12) return { ambiguous: `${String(base)}px is under every role: a drawing, or caption` }
    if (base >= 18 && base <= 20) return { ambiguous: `${String(base)}px at 400: lead or body` }
    return { ambiguous: `${String(base)}px with no step: display.section or title.card` }
}

/** Resolve one site class list: a role and the rewritten list, an ambiguity, or null when it holds no raw size. `onlySteps` keeps all but a stepped display or lead raw (a drawing). */
export function mapSiteClassList(list: string, tag: string | null, onlySteps = false): Mapped {
    const tokens = list.split(/\s+/).filter(Boolean)
    const bases = tokens.filter((t) => BASE_SIZE_RE.test(t))
    const steps = tokens.filter((t) => STEP_SIZE_RE.test(t))
    const others = tokens.filter((t) => OTHER_SIZE_RE.test(t) && !STEP_SIZE_RE.test(t))
    if (bases.length === 0 && steps.length === 0 && others.length === 0) return null
    if (others.length > 0) return onlySteps ? null : { ambiguous: "a state or child size variant" }
    if (bases.length !== 1) return onlySteps ? null : { ambiguous: bases.length === 0 ? "a step with no base size" : "more than one size" }
    if (tokens.includes("font-mono")) return onlySteps ? null : mapClassList(list, tag)
    const odd = tokens.find((t) => ODD_WEIGHT_RE.test(t))
    if (odd !== undefined) return onlySteps ? null : { ambiguous: `uses ${odd}` }
    const base = pxOf(stepOf(bases[0] ?? ""))
    const tops = steps.map((t) => pxOf(stepOf(t)))
    if (tops.some((px) => px < base)) return onlySteps ? null : { ambiguous: "a step down from the base size" }
    const top = Math.max(base, ...tops)
    const medium = tokens.some((t) => WEIGHT_RE.test(t) && t !== "font-normal")
    const muted = tokens.includes("text-muted")
    const pill = tokens.some((t) => t.startsWith("rounded")) && tokens.some((t) => t.startsWith("bg-") || t === "border" || t.startsWith("border-"))
    const role = siteRole({ base, top, stepped: steps.length > 0, medium, muted, pill, tag, tokens })
    if (typeof role !== "string") return onlySteps ? null : role
    if (onlySteps && !(steps.length > 0 && SITE_ROLES.includes(role) && role !== "title.card")) return null
    const kept = tokens.filter((t) => {
        if (BASE_SIZE_RE.test(t) || STEP_SIZE_RE.test(t) || WEIGHT_RE.test(t) || OWNED_RE.test(t)) return false
        if ((role === "display.figure" || role === "figure") && t === "tabular-nums") return false
        return !(t === "text-muted" && MUTED_ROLES.has(role))
    })
    return { role, out: [roleClass(role), ...kept].join(" ") }
}

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
export interface V0550Report {
    readonly codemod: "v0550"
    readonly version: "0.55.0"
    readonly mode: "dry" | "execute"
    readonly converted: number
    readonly perRole: Readonly<Record<string, number>>
    readonly files: readonly FileSummary[]
    /** The component folders read as product drawings (a size under 12px): left raw but for a stepped display or lead class. */
    readonly drawings: readonly string[]
    /** The cases left for a person, each marked `TODO(type-role)` in source. */
    readonly findings: readonly (Finding | ApiFinding)[]
    /** The API pass over every source file: each change it made, the APIs deleted in 0.55.0. */
    readonly api: readonly ApiFinding[]
    /** The API cases left for a person, each marked in source (`TODO(grammar-0.55)` or the step's own marker). */
    readonly apiLeft: readonly ApiFinding[]
}

interface Edit {
    readonly pos: number
    readonly end: number
    readonly text: string
}

/** The element each class constant of a folder lands on (`export const TITLE` used as `<h1 className={C.TITLE}>` is h1), read from its .tsx siblings. */
export function constantTags(ts: typeof Compiler, files: readonly { readonly name: string; readonly text: string }[]): Map<string, string> {
    const tags = new Map<string, string>()
    for (const { name, text } of files) {
        if (!name.endsWith(".tsx")) continue
        const sf = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
        const visit = (n: Ts.Node): void => {
            if (ts.isJsxAttribute(n) && n.name.getText(sf) === "className" && n.initializer && ts.isJsxExpression(n.initializer) && n.initializer.expression) {
                const owner = n.parent.parent
                const tag = ts.isJsxOpeningElement(owner) || ts.isJsxSelfClosingElement(owner) ? owner.tagName.getText(sf) : null
                const names = (x: Ts.Node): void => {
                    if (ts.isIdentifier(x) && /^[A-Z][A-Z0-9_]*$/.test(x.text)) {
                        if (tag !== null && !tags.has(x.text)) tags.set(x.text, tag)
                    } else if (ts.isPropertyAccessExpression(x)) names(x.name)
                    else ts.forEachChild(x, names)
                }
                names(n.initializer.expression)
            }
            ts.forEachChild(n, visit)
        }
        visit(sf)
    }
    return tags
}

/** True for a folder's sources that draw a scaled product: any type size under 12px. */
export const drawsProduct = (texts: readonly string[]): boolean =>
    texts.some((text) => [...text.matchAll(/text-\[(\d*\.?\d+)(px|rem)\]/g)].some((m) => (m[2] === "rem" ? Number(m[1]) * 16 : Number(m[1])) < 12))

/** Rewrite one site source. `tags` names the element of each class constant; `drawing` keeps all but stepped display and lead classes raw. */
export function transformSiteSource(ts: typeof Compiler, file: string, original: string, options: { readonly tags?: ReadonlyMap<string, string>; readonly drawing?: boolean } = {}): { readonly text: string; readonly findings: readonly Finding[] } {
    const tags = options.tags ?? new Map<string, string>()
    const drawing = options.drawing === true
    const findings: Finding[] = []
    const sf = ts.createSourceFile(file, original, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const edits: Edit[] = []
    const marked = new Set<Ts.Node>()
    const lineOf = (pos: number): number => sf.getLineAndCharacterOfPosition(pos).line + 1
    /** The element a literal lands on: its JSX element, else the element its constant is used on. */
    const tagOf = (node: Ts.Node): string | null => {
        for (let p: Ts.Node | undefined = node; p; p = p.parent) {
            if (ts.isJsxOpeningElement(p) || ts.isJsxSelfClosingElement(p)) return p.tagName.getText(sf)
            if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return tags.get(p.name.text) ?? null
        }
        return null
    }
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
    /** The statement, property or attribute a marker of `node` stands above. */
    const markTarget = (node: Ts.Node): Ts.Node => {
        let target: Ts.Node = node
        while (target.parent && !ts.isStatement(target) && !ts.isPropertyAssignment(target) && !ts.isJsxAttribute(target) && !ts.isArrayLiteralExpression(target.parent)) target = target.parent
        return target
    }
    const mark = (node: Ts.Node, reason: string): void => {
        if (marked.has(node)) return
        const start = markTarget(node).getStart(sf)
        if (sf.text.slice(Math.max(0, start - 160), start).includes(MARK)) return
        marked.add(node)
        const lineStart = sf.text.lastIndexOf("\n", start - 1) + 1
        const lead = sf.text.slice(lineStart, start)
        const indent = /^\s*/.exec(lead)?.[0] ?? ""
        edits.push(lead.trim() === "" ? { pos: start, end: start, text: `// ${MARK}: ${reason}\n${indent}` } : { pos: start, end: start, text: `/* ${MARK}: ${reason} */ ` })
    }
    /** Drop the v0540 marker of a case this codemod converts: the comment line right above it, or the inline comment before it. */
    const unmark = (node: Ts.Node): void => {
        const start = markTarget(node).getStart(sf)
        const inline = /\/\* TODO\(type-role\): [^*]*\*\/ $/.exec(sf.text.slice(Math.max(0, start - 200), start))
        if (inline !== null) {
            edits.push({ pos: start - inline[0].length, end: start, text: "" })
            return
        }
        const lineStart = sf.text.lastIndexOf("\n", start - 1) + 1
        if (sf.text.slice(lineStart, start).trim() !== "") return
        const prevStart = sf.text.lastIndexOf("\n", lineStart - 2) + 1
        if (/^\s*\/\/ TODO\(type-role\): .*\r?\n$/.test(sf.text.slice(prevStart, lineStart))) edits.push({ pos: prevStart, end: lineStart, text: "" })
    }

    const classLiteral = (lit: Ts.Node): void => {
        if (ts.isTemplateExpression(lit)) {
            const all = [lit.head.text, ...lit.templateSpans.map((s) => s.literal.text)].join(" ")
            if (!drawing && all.split(/\s+/).some((t) => BASE_SIZE_RE.test(t) || STEP_SIZE_RE.test(t))) {
                findings.push({ file, line: lineOf(lit.getStart(sf)), kind: "class", reason: "dynamic template literal", before: lit.getText(sf).slice(0, 120) })
                mark(lit, "dynamic template literal")
            }
            return
        }
        const text = staticText(lit)
        if (text === null) return
        const scopeNode = classScope(lit)
        let res = mapSiteClassList(text, tagOf(lit), drawing)
        if (res === null) return
        if (!("ambiguous" in res) && scopeNode !== lit) {
            const clash = literalsIn(scopeNode).filter((n) => n !== lit).some((n) => {
                const s = staticText(n)
                return s !== null && s.split(/\s+/).some((t) => WEIGHT_RE.test(t) || t === "text-muted" || t === "font-mono" || OWNED_RE.test(t) || BASE_SIZE_RE.test(t) || OTHER_SIZE_RE.test(t))
            })
            if (clash) res = { ambiguous: "size and its neighbours split across cn() arguments" }
        }
        const line = lineOf(lit.getStart(sf))
        if ("ambiguous" in res) {
            findings.push({ file, line, kind: "class", reason: res.ambiguous, before: text })
            mark(ts.findAncestor(lit, ts.isJsxAttribute) ?? lit, res.ambiguous)
            return
        }
        unmark(ts.findAncestor(lit, ts.isJsxAttribute) ?? lit)
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
        if (drawing) return
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
            // The site keeps a strong 14 in its own tone: label.item draws no colour, so the tone stays on the Text.
            role = strongV ? "label.item" : "body"
        } else return fail(`unknown size ${s}`)
        // A v0540 marker after the tag name goes with the case.
        const marker = / \/\/ TODO\(type-role\): [^\n]*\n\s*/.exec(sf.text.slice(el.tagName.getEnd(), el.getEnd()))
        if (marker !== null && marker.index === 0) edits.push({ pos: el.tagName.getEnd(), end: el.tagName.getEnd() + marker[0].length, text: " " })
        const drop = new Set<Ts.JsxAttribute>()
        for (const a of [size, strong, mono]) if (a) drop.add(a)
        if (dropTone && tone) drop.add(tone)
        if (role === "figure" && strong) drop.delete(strong)
        const ordered = [...drop].sort((a, b) => a.getStart(sf) - b.getStart(sf))
        const first = ordered[0]
        for (const a of ordered) {
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

/** Run v0550 over an app checkout's site files. Dry unless `write`. */
export function runV0550({ root, write, ts }: { readonly root: string; readonly write: boolean; readonly ts: typeof Compiler }): V0550Report {
    const all: string[] = []
    for (const dir of sourceRoots(root)) walk(dir, all)
    // The API pass first, over every file: the site pass then reads its output.
    const api: ApiFinding[] = []
    const apiLeft: ApiFinding[] = []
    const current = new Map<string, string>()
    const originals = new Map<string, string>()
    for (const path of all.sort()) {
        const rel = relative(root, path).replaceAll("\\", "/")
        const original = readFileSync(path, "utf8")
        originals.set(path, original)
        const { text, findings } = transformApiSource(ts, rel, original, { site: isSitePath(rel) })
        current.set(path, text)
        for (const f of findings) (f.reason === undefined ? api : apiLeft).push(f)
    }
    const files = all.filter((path) => isSitePath(relative(root, path))).sort()
    const byDir = new Map<string, { name: string; text: string }[]>()
    for (const path of files) {
        const list = byDir.get(dirname(path)) ?? []
        list.push({ name: path, text: current.get(path) ?? readFileSync(path, "utf8") })
        byDir.set(dirname(path), list)
    }
    const drawings: string[] = []
    const summaries: FileSummary[] = []
    const left: Finding[] = []
    const perRole: Record<string, number> = {}
    let converted = 0
    for (const [dir, sources] of [...byDir.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const drawing = drawsProduct(sources.map((s) => s.text))
        if (drawing) drawings.push(relative(root, dir).replaceAll("\\", "/"))
        const tags = constantTags(ts, sources)
        for (const { name: path, text: original } of sources) {
            const rel = relative(root, path).replaceAll("\\", "/")
            const { text, findings } = transformSiteSource(ts, rel, original, { tags, drawing })
            current.set(path, text)
            if (findings.length === 0) continue
            const done = findings.filter((f) => f.role !== undefined)
            for (const f of done) perRole[f.role as string] = (perRole[f.role as string] ?? 0) + 1
            converted += done.length
            left.push(...findings.filter((f) => f.role === undefined))
            summaries.push({ file: rel, converted: done.length, todos: findings.length - done.length, changed: text !== originals.get(path) })
        }
    }
    if (write) for (const [path, text] of current) if (text !== originals.get(path)) writeFileSync(path, text)
    return { codemod: "v0550", version: "0.55.0", mode: write ? "execute" : "dry", converted, perRole, files: summaries, drawings, findings: [...left, ...apiLeft], api, apiLeft }
}

/** The report as Markdown: the per-file summary, the conversions per role, the drawings left raw and every case left for a person. */
export function v0550Markdown(report: V0550Report): string {
    const lines = [`# starci app codemod v0550 (Grammar ${report.version}: the site group), ${report.mode}`, ""]
    lines.push(`${String(report.converted)} conversions in ${String(report.files.length)} site files; ${String(report.findings.length)} cases left for a person, marked \`${MARK}\`; ${String(report.drawings.length)} product drawings left raw.`, "")
    if (Object.keys(report.perRole).length) lines.push("| Role | Conversions |", "| --- | --- |", ...Object.entries(report.perRole).map(([role, count]) => `| ${role} | ${String(count)} |`), "")
    if (report.files.length) lines.push("| File | Converted | TODO | Changed |", "| --- | --- | --- | --- |", ...report.files.map((f) => `| ${f.file} | ${String(f.converted)} | ${String(f.todos)} | ${f.changed ? (report.mode === "execute" ? "written" : "would change") : "no"} |`), "")
    if (report.drawings.length) lines.push("## Product drawings (a size under 12px, left raw)", "", ...report.drawings.map((d) => `- ${d}`), "")
    if (report.api.length) lines.push("## Deleted APIs (0.55.0)", "", "| File | Step | Change |", "| --- | --- | --- |", ...report.api.map((f) => `| ${f.file}:${String(f.line)} | ${f.step} | ${(f.after ?? "").replaceAll("|", "\|")} |`), "")
    if (report.apiLeft.length) lines.push(`## Deleted APIs left for a person`, "", ...report.apiLeft.map((f) => `- ${f.file}:${String(f.line)} ${f.step}: ${f.reason ?? ""}`), "")
    const typeLeft = report.findings.filter((f): f is Finding => "kind" in f)
    if (typeLeft.length) lines.push(`## ${MARK}`, "", ...typeLeft.map((f) => `- ${f.file}:${String(f.line)} ${f.reason ?? ""}: \`${f.before.replaceAll("`", "'")}\``), "")
    return `${lines.join("\n")}\n`
}
