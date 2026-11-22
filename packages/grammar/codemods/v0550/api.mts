/**
 * v0550, the API pass: every Grammar API deleted in 0.55.0 (owner 2026-11-22: "deprecate thì xóa lun khỏi đánh annotation"). It reads
 * every source file of the app, not only the site, and runs each step of `API_STEPS` over each Grammar element:
 *
 *   - a deleted prop with no meaning left is dropped (`<IconTile size>`, `<Timeline marker>`, `<Stepper completeMarker>`, ...);
 *   - a deleted prop with a successor is moved onto it (`<Text size>` outside the site becomes its `role`, as v0540 maps it);
 *   - a deleted component or export it cannot rewrite is marked `// TODO(grammar-0.55): <what to use>` and listed.
 *
 * A step names its element and its props; it is data plus one small function, so the report and the codemod cannot drift.
 */
import type * as Ts from "typescript"
import type Compiler from "typescript"
import { textPropRole } from "../v0540/index.mts"
import { BUTTON_DELETED_EXPORTS, BUTTON_MARK, BUTTON_STEPS, rewriteIntentProperty } from "./button.mts"

/** The marker of an API case left for a person. */
export const API_MARK = "TODO(grammar-0.55)"

/** One API change or one case left for a person. */
export interface ApiFinding {
    readonly file: string
    readonly line: number
    readonly step: string
    /** Set when the case is left for a person (marked in source). */
    readonly reason?: string
    readonly before: string
    readonly after?: string
}

type Element = Ts.JsxOpeningElement | Ts.JsxSelfClosingElement

/** What a step sees of one element, and the edits it may make. */
export interface StepContext {
    readonly ts: typeof Compiler
    readonly sf: Ts.SourceFile
    readonly el: Element
    /** The element's name, a member access read as its last part (`G.Avatar` is `Avatar`). */
    readonly name: string
    /** True in a file of the public site (v0550's site pass owns its Text). */
    readonly site: boolean
    readonly attr: (name: string) => Ts.JsxAttribute | undefined
    /** The literal value of an attribute: a string, `true`, `undefined` when absent or false, `null` when not literal. */
    readonly literal: (a: Ts.JsxAttribute | undefined) => string | number | true | null | undefined
    readonly drop: (a: Ts.JsxAttribute) => void
    readonly replace: (a: Ts.JsxAttribute, text: string) => void
    /** Replace any span of the file (an object key inside a prop, a constant the prop names). */
    readonly edit: (pos: number, end: number, text: string) => void
    /** The expression of an attribute, a plain identifier followed to its `const` initializer in the same file. */
    readonly expression: (a: Ts.JsxAttribute | undefined) => Ts.Expression | undefined
    /** Mark the element for a person, with the reason. */
    readonly mark: (reason: string, marker?: string) => void
    /** True when the element sits inline: inside text, a Chip or Badge, a table cell, or beside a label (a sibling text node or Text). */
    readonly inline: () => boolean | null
    readonly changed: (after: string) => void
}

/** One step of the API pass. */
export interface ApiStep {
    readonly id: string
    readonly summary: string
    /** The Grammar elements it reads. */
    readonly elements: readonly string[]
    readonly apply: (ctx: StepContext) => void
}

/** A step that drops props that have no meaning left. */
export const dropProps = (id: string, elements: readonly string[], props: readonly string[], summary: string): ApiStep => ({
    id,
    summary,
    elements,
    apply: (ctx) => {
        const gone = props.map(ctx.attr).filter((a): a is Ts.JsxAttribute => a !== undefined)
        for (const a of gone) ctx.drop(a)
        if (gone.length) ctx.changed(`dropped ${gone.map((a) => a.name.getText(ctx.sf)).join(", ")}`)
    },
})

/** A step that marks every use of a deleted component: there is no mechanical rewrite. */
export const markComponent = (id: string, elements: readonly string[], instead: string): ApiStep => ({
    id,
    summary: `${elements.join(" and ")} are deleted: ${instead}`,
    elements,
    apply: (ctx) => ctx.mark(`${ctx.name} is deleted in 0.55.0; use ${instead}`),
})

/** `<Text size>` outside the site: the v0540 mapping onto `role`. The site's Text is the site pass's. */
const textSize: ApiStep = {
    id: "text-size",
    summary: "<Text size> and <ExpandableText size> are deleted: each becomes its role (xs caption, sm and md body, figure figure; isStrong and mono as v0540 maps them)",
    elements: ["Text", "ExpandableText"],
    apply: (ctx) => {
        const size = ctx.attr("size")
        if (ctx.site || size === undefined || ctx.attr("role")) return
        if (ctx.el.attributes.properties.some((a) => ctx.ts.isJsxSpreadAttribute(a))) return ctx.mark("spread props: set role, Text has no size", API_MARK)
        const strong = ctx.attr("isStrong")
        const mono = ctx.attr("mono")
        const tone = ctx.attr("tone")
        const [s, st, mo, to] = [ctx.literal(size), ctx.literal(strong), ctx.literal(mono), ctx.literal(tone)]
        if (s === null || st === null || mo === null) return ctx.mark("non-literal size, isStrong or mono: set role, Text has no size", API_MARK)
        const res = textPropRole({ size: String(s), strong: st === true, mono: mo === true, tone: to === undefined ? undefined : to === null ? null : String(to) })
        if ("fail" in res) return ctx.mark(`${res.fail}: set role, Text has no size`, API_MARK)
        ctx.replace(size, `role="${res.role}"`)
        if (strong && res.role !== "figure") ctx.drop(strong)
        if (mono) ctx.drop(mono)
        if (res.dropTone && tone) ctx.drop(tone)
        ctx.changed(`role="${res.role}"`)
    },
}

/** The marker of a round-mark size the codemod cannot place. */
export const AVATAR_SIZE_MARK = "TODO(avatar-size)"

/**
 * The round-mark sizes (owner 2026-11-22: "giữ 2 size phổ biến 40 và 24 thôi, không có 32"): `lg` and `control` become `md` (40); the old `sm` (32) becomes `sm` (24)
 * inline (in text, a Chip or Badge, a table cell, beside a label) and `md` (40) standalone (a list lead, a header, a card head); anything else is marked.
 */
const avatarSize: ApiStep = {
    id: "avatar-size",
    summary: "Avatar, AvatarButton and AvatarGroup take sm 24 or md 40 only: lg and control become md; the old sm 32 becomes sm inline and md standalone",
    elements: ["Avatar", "AvatarButton", "AvatarGroup"],
    apply: (ctx) => {
        const size = ctx.attr("size")
        if (size === undefined) return
        const value = ctx.literal(size)
        if (value === "md" || value === "floating") return
        if (value === "lg" || value === "control") {
            ctx.replace(size, 'size="md"')
            ctx.changed(`size="${value}" is md 40`)
            return
        }
        if (value === "sm") {
            const inline = ctx.inline()
            if (inline === true) return
            if (inline === false) {
                ctx.replace(size, 'size="md"')
                ctx.changed('size="sm" (32) standalone is md 40')
                return
            }
            return ctx.mark("the old sm 32: sm 24 inline (beside text, in a chip or cell), md 40 standalone (a lead, a header, a card head)", AVATAR_SIZE_MARK)
        }
        return ctx.mark("size is not a literal sm or md: pick sm 24 inline or md 40 standalone", AVATAR_SIZE_MARK)
    },
}

/** The marker of a chart case the codemod cannot finish (core's hand-drawn charts are deleted; the ext's props differ). */
export const CHART_MARK = "TODO(chart)"

/** The module every chart moves to. */
export const CHART_MODULE = "@starci/grammar/core/ext/recharts"

/**
 * Core's hand-drawn `BarChart` and `Sparkline` are deleted (owner: "every chart or sparkline uses the ext, never hand-drawn SVG"). The
 * import moves to the ext (MOVED_EXPORTS); this step maps the props: `label` is `ariaLabel`, `bars` is `data` with `xKey="label"`
 * `yKey="value"`, a Sparkline's `values` become rows `{ index, value }`. What has no equal (`empty` as a node, `valueAxis`,
 * `highlightLast`, `error`, the required `emptyLabel` string) is marked `TODO(chart)`. An element already on the ext's props is left.
 */
const coreChart: ApiStep = {
    id: "core-chart",
    summary: "core BarChart and Sparkline are deleted: imports move to @starci/grammar/core/ext/recharts, label becomes ariaLabel, bars and values become data with xKey and yKey; empty, valueAxis, highlightLast and error are marked TODO(chart)",
    elements: ["BarChart", "Sparkline"],
    apply: (ctx) => {
        const label = ctx.attr("label")
        const series = ctx.attr(ctx.name === "BarChart" ? "bars" : "values")
        if (series === undefined && (label === undefined || ctx.attr("ariaLabel") !== undefined)) return
        const done: string[] = []
        if (label) {
            ctx.replace(label, `ariaLabel${label.initializer ? `=${label.initializer.getText(ctx.sf)}` : ""}`)
            done.push("ariaLabel")
        }
        if (series?.initializer && ctx.ts.isJsxExpression(series.initializer) && series.initializer.expression) {
            const value = series.initializer.expression.getText(ctx.sf)
            ctx.replace(series, ctx.name === "BarChart" ? `data={${value}} xKey="label" yKey="value"` : `data={(${value}).map((value, index) => ({ index, value }))} xKey="index" yKey="value"`)
            done.push("data, xKey, yKey")
        }
        const open = ["empty", "valueAxis", "highlightLast", "error"].filter((prop) => ctx.attr(prop) !== undefined)
        if (ctx.attr("emptyLabel") === undefined) open.push("emptyLabel (required, a string)")
        if (ctx.ts.isPropertyAccessExpression(ctx.el.tagName)) open.unshift(`import ${ctx.name} from ${CHART_MODULE} (the namespace no longer has it)`)
        if (done.length) ctx.changed(done.join(", "))
        if (open.length) ctx.mark(`${ctx.name} is the ext chart now; set ${open.join(", ")}`, CHART_MARK)
    },
}

/**
 * A provider mark's `icon` is its `logo` (owner 2026-11-22, overview-v2: a provider always shows the app's brand logo, never initials): `mark={{ icon }}` on an
 * Avatar or AvatarButton and `mark: { icon }` in an AvatarGroup's items (inline, or a `const` of the same file) are renamed. A mark built in another file is left to
 * the type checker, which refuses the unknown `icon`.
 */
const avatarMarkLogo: ApiStep = {
    id: "avatar-mark-logo",
    summary: "an Avatar or AvatarGroup mark's icon is its logo: mark.icon becomes mark.logo (no logo draws the generic channel glyph, never initials)",
    elements: ["Avatar", "AvatarButton", "AvatarGroup"],
    apply: (ctx) => {
        const { ts } = ctx
        let renamed = 0
        const renameIn = (mark: Ts.Expression | undefined): void => {
            if (mark === undefined || !ts.isObjectLiteralExpression(mark)) return
            for (const p of mark.properties) {
                if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && ts.isIdentifier(p.name) && p.name.text === "icon") {
                    ctx.edit(p.name.getStart(ctx.sf), p.name.getEnd(), ts.isShorthandPropertyAssignment(p) ? "logo: icon" : "logo")
                    renamed += 1
                }
            }
        }
        if (ctx.name === "AvatarGroup") {
            const items = ctx.expression(ctx.attr("items"))
            if (items === undefined || !ts.isArrayLiteralExpression(items)) return
            for (const item of items.elements) {
                if (!ts.isObjectLiteralExpression(item)) continue
                const mark = item.properties.find((p): p is Ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "mark")
                if (mark) renameIn(mark.initializer)
            }
        } else {
            const mark = ctx.attr("mark")
            if (mark === undefined) return
            renameIn(ctx.expression(mark))
        }
        if (renamed > 0) ctx.changed(`mark icon is logo (${String(renamed)})`)
    },
}

/** Every step of the API pass, in the order they run. Other steps (the round-mark and icon sizes) register here too. */
export const API_STEPS: ApiStep[] = [
    textSize,
    dropProps("icon-tile-size", ["IconTile"], ["size"], "<IconTile size> is deleted: every IconTile is one round 40px plate"),
    dropProps("timeline-marker", ["Timeline"], ["marker"], "<Timeline marker> is deleted: each marker is the status tile of its status or state"),
    dropProps("stepper-complete-marker", ["Stepper"], ["completeMarker"], "<Stepper completeMarker> is deleted: a complete step is always the check"),
    dropProps("avatar-fallback-mark", ["Avatar", "AvatarButton"], ["fallbackMark"], "<Avatar fallbackMark> and <AvatarButton fallbackMark> are deleted: an avatar with no src draws its initials"),
    dropProps("alert-appearance", ["Alert"], ["appearance"], "<Alert appearance> is deleted: an Alert has one look, its tone's soft pair"),
    dropProps("grammar-root-theme", ["GrammarRoot"], ["theme"], "<GrammarRoot theme> is deleted: the mode is `.dark` on html"),
    avatarSize,
    avatarMarkLogo,
    dropProps("avatar-group-member-names", ["AvatarGroup"], ["memberNames"], "<AvatarGroup memberNames> is deleted: hover, focus or a tap opens the member list"),
    markComponent("button-group", ["ButtonGroup"], "separate Buttons, or a DropdownMenu for the overflow (R380)"),
    markComponent("filter-button-group", ["FilterButtonGroup"], "Tabs kind=\"filter\" (R380)"),
    coreChart,
    ...BUTTON_STEPS,
]

/** The exports that moved out of the core entries in 0.55.0, and their new module: the import is rewritten. */
export const MOVED_EXPORTS: Readonly<Record<string, string>> = Object.freeze({
    BarChart: CHART_MODULE,
    Sparkline: CHART_MODULE,
    BarChartProps: CHART_MODULE,
    SparklineProps: CHART_MODULE,
})

/** The Grammar entries the moved exports left (the ext entries are not among them). */
const MOVED_FROM = new Set(["@starci/grammar", "@starci/grammar/core", "@starci/grammar/common", "@starci/grammar/offset-pop"])

/** Object properties deleted in 0.55.0 (a data shape, not a JSX prop): each is marked for a person, with its marker. */
export const DELETED_PROPERTIES: Readonly<Record<string, { readonly instead: string; readonly marker: string }>> = Object.freeze({
    trendLine: { instead: `trendChart={<Sparkline …/>} of ${CHART_MODULE} (a Figure takes the drawn chart)`, marker: CHART_MARK },
    trendLineLabel: { instead: "the Sparkline's ariaLabel in trendChart", marker: CHART_MARK },
})

/** The exports deleted in 0.55.0 that a file may import: each import is marked for a person. */
export const DELETED_EXPORTS: Readonly<Record<string, string>> = Object.freeze({
    AlertAppearance: "nothing: an Alert has one look",
    TextSize: "TextRole",
    ButtonGroupProps: "separate Buttons",
    ButtonGroupAction: "separate Buttons",
    FilterButtonGroupProps: "Tabs kind=\"filter\"",
    FilterOption: "Tabs kind=\"filter\"",
    STARCI_CORE_TOKEN_NAMES: "the custom properties of @starci/grammar/core/theme.css",
    STARCI_CORE_TOKEN_DEFAULTS: "@starci/grammar/core/theme.css",
    STARCI_CORE_DARK_TOKEN_DEFAULTS: "the .dark block of @starci/grammar/core/theme.css",
    StarCiCoreTokenName: "a string custom property name",
    StarCiCoreTokenDefaults: "@starci/grammar/core/theme.css",
    OFFSET_POP_TOKEN_NAMES: "the custom properties of @starci/grammar/offset-pop/theme.css",
    OFFSET_POP_TOKEN_DEFAULTS: "@starci/grammar/offset-pop/theme.css",
    OFFSET_POP_DARK_TOKEN_DEFAULTS: "the .dark block of @starci/grammar/offset-pop/theme.css",
    OffsetPopTokenName: "a string custom property name",
    OffsetPopTokenDefaults: "@starci/grammar/offset-pop/theme.css",
    BarChartBar: `rows of your own with the ${CHART_MODULE} BarChart xKey and yKey`,
    BarChartValueAxis: `the ext BarChart's axis props (${CHART_MODULE})`,
    ...BUTTON_DELETED_EXPORTS,
})

interface Edit {
    readonly pos: number
    readonly end: number
    readonly text: string
}

const lastName = (ts: typeof Compiler, sf: Ts.SourceFile, el: Element): string => {
    const tag = el.tagName
    return ts.isPropertyAccessExpression(tag) ? tag.name.getText(sf) : tag.getText(sf)
}

/** The slots that hold a mark on its own: a list lead, a bubble's avatar, a header's mark or actions. */
const STANDALONE_SLOTS = new Set(["leading", "avatar", "media", "header", "mark", "actions"])

const INLINE_PARENTS = new Set(["Chip", "Badge", "Text", "td", "th", "span", "p", "label", "TableCell", "Cell"])

/** Run the API pass over one source. `site` says whether the file is the public site's. */
export function transformApiSource(ts: typeof Compiler, file: string, original: string, options: { readonly site?: boolean; readonly steps?: readonly ApiStep[] } = {}): { readonly text: string; readonly findings: readonly ApiFinding[] } {
    const steps = options.steps ?? API_STEPS
    const site = options.site === true
    const findings: ApiFinding[] = []
    const edits: Edit[] = []
    const sf = ts.createSourceFile(file, original, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const lineOf = (pos: number): number => sf.getLineAndCharacterOfPosition(pos).line + 1
    const markAt = (node: Ts.Node, reason: string, marker: string): void => {
        let target: Ts.Node = node
        while (target.parent && !ts.isStatement(target) && !ts.isJsxElement(target.parent) && !ts.isJsxFragment(target.parent) && !ts.isJsxExpression(target.parent)) target = target.parent
        const start = target.getStart(sf)
        if (sf.text.slice(Math.max(0, start - 200), start).includes(`${marker}: ${reason}`)) return
        const lineStart = sf.text.lastIndexOf("\n", start - 1) + 1
        const lead = sf.text.slice(lineStart, start)
        const indent = /^\s*/.exec(lead)?.[0] ?? ""
        const inJsx = target.parent !== undefined && (ts.isJsxElement(target.parent) || ts.isJsxFragment(target.parent))
        const text = inJsx ? `{/* ${marker}: ${reason} */}\n${indent}` : lead.trim() === "" ? `// ${marker}: ${reason}\n${indent}` : `/* ${marker}: ${reason} */ `
        edits.push({ pos: start, end: start, text })
    }
    const visit = (n: Ts.Node): void => {
        if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
            const el = n
            const name = lastName(ts, sf, el)
            const before = (el.getText(sf).split("\n")[0] ?? "").slice(0, 120)
            for (const step of steps) {
                if (!step.elements.includes(name)) continue
                const attr = (prop: string): Ts.JsxAttribute | undefined => el.attributes.properties.find((a): a is Ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText(sf) === prop)
                const literal = (a: Ts.JsxAttribute | undefined): string | number | true | null | undefined => {
                    if (!a) return undefined
                    if (!a.initializer) return true
                    if (ts.isStringLiteral(a.initializer)) return a.initializer.text
                    if (ts.isJsxExpression(a.initializer) && a.initializer.expression) {
                        const x = a.initializer.expression
                        if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) return x.text
                        if (ts.isNumericLiteral(x)) return Number(x.text)
                        if (x.kind === ts.SyntaxKind.TrueKeyword) return true
                        if (x.kind === ts.SyntaxKind.FalseKeyword) return undefined
                    }
                    return null
                }
                const inline = (): boolean | null => {
                    const owner = ts.isJsxOpeningElement(el) ? el.parent : el
                    const parent = owner.parent
                    if (parent === undefined) return null
                    if (ts.isJsxElement(parent)) {
                        const parentName = lastName(ts, sf, parent.openingElement)
                        if (INLINE_PARENTS.has(parentName)) return true
                        const siblings = parent.children.filter((c) => c !== owner && !(ts.isJsxText(c) && c.containsOnlyTriviaWhiteSpaces))
                        if (siblings.some((c) => ts.isJsxText(c) || (ts.isJsxElement(c) && ["Text", "AgentName"].includes(lastName(ts, sf, c.openingElement))))) return true
                        return null
                    }
                    if (ts.isJsxAttribute(parent.parent ?? parent)) {
                        const prop = (parent.parent as Ts.JsxAttribute).name.getText(sf)
                        if (["startContent", "endContent", "icon"].includes(prop)) return true
                        if (STANDALONE_SLOTS.has(prop)) return false
                    }
                    if (ts.isPropertyAssignment(parent) && STANDALONE_SLOTS.has(parent.name.getText(sf))) return false
                    return null
                }
                let changed: string | undefined
                step.apply({
                    ts, sf, el, name, site, attr, literal, inline,
                    drop: (a) => edits.push({ pos: a.getFullStart(), end: a.getEnd(), text: "" }),
                    replace: (a, text) => edits.push({ pos: a.getStart(sf), end: a.getEnd(), text }),
                    edit: (pos, end, text) => edits.push({ pos, end, text }),
                    expression: (a) => {
                        const init = a?.initializer
                        if (init === undefined || !ts.isJsxExpression(init) || init.expression === undefined) return undefined
                        let x: Ts.Expression = init.expression
                        while (ts.isAsExpression(x) || ts.isParenthesizedExpression(x) || ts.isSatisfiesExpression(x)) x = x.expression
                        if (!ts.isIdentifier(x)) return x
                        const name = x.text
                        let found: Ts.Expression | undefined
                        const look = (n: Ts.Node): void => {
                            if (found) return
                            if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer && ts.isVariableDeclarationList(n.parent) && (n.parent.flags & ts.NodeFlags.Const) !== 0) found = n.initializer
                            else ts.forEachChild(n, look)
                        }
                        look(sf)
                        while (found && (ts.isAsExpression(found) || ts.isParenthesizedExpression(found) || ts.isSatisfiesExpression(found))) found = found.expression
                        return found ?? x
                    },
                    mark: (reason, marker = API_MARK) => {
                        findings.push({ file, line: lineOf(el.getStart(sf)), step: step.id, reason, before })
                        markAt(ts.isJsxOpeningElement(el) ? el.parent : el, reason, marker)
                    },
                    changed: (after) => { changed = after },
                })
                if (changed !== undefined) findings.push({ file, line: lineOf(el.getStart(sf)), step: step.id, before, after: changed })
            }
        }
        if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.moduleSpecifier.text.startsWith("@starci/grammar")) {
            const named = n.importClause?.namedBindings
            if (named && ts.isNamedImports(named) && MOVED_FROM.has(n.moduleSpecifier.text)) {
                const movedTo = (spec: Ts.ImportSpecifier): string | undefined => MOVED_EXPORTS[(spec.propertyName ?? spec.name).text]
                const moved = named.elements.filter((spec) => movedTo(spec) !== undefined)
                const targets = [...new Set(moved.map((spec) => movedTo(spec) as string))]
                if (moved.length > 0) {
                    const quote = sf.text[n.moduleSpecifier.getStart(sf)] ?? "\""
                    const typeOnly = n.importClause?.isTypeOnly === true
                    const line = (specs: readonly Ts.ImportSpecifier[], module: string): string => `import ${typeOnly ? "type " : ""}{ ${specs.map((spec) => spec.getText(sf)).join(", ")} } from ${quote}${module}${quote}`
                    if (moved.length === named.elements.length && targets.length === 1 && n.importClause?.name === undefined) {
                        edits.push({ pos: n.moduleSpecifier.getStart(sf) + 1, end: n.moduleSpecifier.getEnd() - 1, text: targets[0] as string })
                    } else {
                        const kept = named.elements.filter((spec) => !moved.includes(spec))
                        const semi = n.getText(sf).trimEnd().endsWith(";") ? ";" : ""
                        const lines = [
                            ...(kept.length > 0 ? [line(kept, n.moduleSpecifier.text)] : []),
                            ...targets.map((module) => line(moved.filter((spec) => movedTo(spec) === module), module)),
                        ]
                        edits.push({ pos: n.getStart(sf), end: n.getEnd(), text: lines.map((l) => `${l}${semi}`).join("\n") })
                    }
                    findings.push({ file, line: lineOf(n.getStart(sf)), step: "moved-export", before: n.getText(sf).slice(0, 120), after: `${moved.map((spec) => spec.name.text).join(", ")} from ${targets.join(", ")}` })
                }
            }
            if (named && ts.isNamedImports(named)) {
                for (const spec of named.elements) {
                    const imported = (spec.propertyName ?? spec.name).text
                    const instead = DELETED_EXPORTS[imported]
                    if (instead === undefined) continue
                    const reason = `${imported} is deleted in 0.55.0; use ${instead}`
                    findings.push({ file, line: lineOf(n.getStart(sf)), step: "deleted-export", reason, before: n.getText(sf).slice(0, 120) })
                    markAt(n, reason, API_MARK)
                }
            }
        }
        if (grammarFile && ts.isPropertyAssignment(n)) {
            const intent = rewriteIntentProperty(ts, sf, n)
            if (intent?.reason !== undefined) {
                findings.push({ file, line: lineOf(n.getStart(sf)), step: "button-variant", reason: intent.reason, before: n.getText(sf).slice(0, 120) })
                const start = n.getStart(sf)
                if (!sf.text.slice(Math.max(0, start - 300), start).includes(`${BUTTON_MARK}: ${intent.reason}`)) edits.push({ pos: start, end: start, text: `/* ${BUTTON_MARK}: ${intent.reason} */ ` })
            } else if (intent?.after !== undefined) {
                edits.push(...intent.edits)
                findings.push({ file, line: lineOf(n.getStart(sf)), step: "button-variant", before: n.getText(sf).slice(0, 120), after: intent.after })
            }
        }
        if (grammarFile && ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name))) {
            const gone = DELETED_PROPERTIES[n.name.text]
            if (gone !== undefined) {
                const reason = `${n.name.text} is deleted in 0.55.0; use ${gone.instead}`
                findings.push({ file, line: lineOf(n.getStart(sf)), step: "deleted-property", reason, before: n.getText(sf).slice(0, 120) })
                const start = n.getStart(sf)
                if (!sf.text.slice(Math.max(0, start - 300), start).includes(`${gone.marker}: ${reason}`)) edits.push({ pos: start, end: start, text: `/* ${gone.marker}: ${reason} */ ` })
            }
        }
        ts.forEachChild(n, visit)
    }
    const grammarFile = sf.statements.some((st) => ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.moduleSpecifier.text.startsWith("@starci/grammar"))
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
