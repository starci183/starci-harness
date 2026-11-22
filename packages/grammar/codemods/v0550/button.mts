/**
 * v0550, the Button pass (owner 2026-11-22: "chỉ có danger, border, và primary thôi, k có tertiary nữa"). A Grammar Button and IconButton have
 * exactly three looks, one prop: `variant: "primary" | "border" | "danger"` (border the default). Every intent, step and vendor variant is deleted:
 *
 *   - `intent` and the old `variant` become the new `variant` by `BUTTON_VARIANT_MAP` (commit is primary; neutral, alternative, dismiss, retry,
 *     secondary, tertiary, outline, ghost and flat are border; destructive, danger and danger-soft are danger); `step` is dropped;
 *   - a Button `tone` stays the colour of a primary: a toned Button becomes `variant="primary"` (a `tone="danger"` is `variant="danger"`, untoned);
 *   - `<EmptyNotice actionIntent>` is `actionVariant` (commit primary, neutral border);
 *   - an item action's `intent: "<literal>"` (ListRow, SurfaceCard and every action object of a file that imports the Grammar) is `variant`, and its
 *     `isPrimary` is dropped (a `primary` row action is the region's one primary on its own);
 *   - a value it cannot decide (a dynamic expression) stays, marked `TODO(button)` and listed. A conditional between literals is mapped branch by branch.
 */
import type * as Ts from "typescript"
import type Compiler from "typescript"
import type { ApiStep, StepContext } from "./api.mts"

/** The marker of a Button case left for a person. */
export const BUTTON_MARK = "TODO(button)"

/** The three looks of Grammar 0.55.0. */
export type ButtonVariant = "primary" | "border" | "danger"

/** Every old intent and vendor variant, and the look it becomes. Data, so the report and the codemod cannot drift. */
export const BUTTON_VARIANT_MAP: Readonly<Record<string, ButtonVariant>> = Object.freeze({
    // the intents
    commit: "primary",
    neutral: "border",
    alternative: "border",
    dismiss: "border",
    retry: "border",
    destructive: "danger",
    // the vendor variants
    primary: "primary",
    secondary: "border",
    tertiary: "border",
    outline: "border",
    ghost: "border",
    flat: "border",
    border: "border",
    danger: "danger",
    "danger-soft": "danger",
})

/** The intents alone: an object property or an `actionIntent` maps only these (`intent` is a common word; "primary" there may be anything). */
export const INTENT_MAP: Readonly<Record<string, ButtonVariant>> = Object.freeze(Object.fromEntries(["commit", "neutral", "alternative", "dismiss", "retry", "destructive"].map((k) => [k, BUTTON_VARIANT_MAP[k] as ButtonVariant])))

/** The exports deleted with the intents: each import is marked for a person. */
export const BUTTON_DELETED_EXPORTS: Readonly<Record<string, string>> = Object.freeze({
    ButtonIntent: "ButtonVariant (\"primary\" | \"border\" | \"danger\")",
    ButtonIntentProps: "ButtonLook ({ variant, tone })",
    DestructiveStep: "nothing: a destruction is variant=\"danger\" at its entry and its confirm",
    ButtonPlacement: "nothing: a Button's look no longer depends on where it sits",
    ButtonPlacementProvider: "nothing: a Button's look no longer depends on where it sits",
    ButtonIntentFamilyProvider: "nothing: GrammarRoot needs no intent family",
    useButtonIntentVariant: "the variant prop itself",
    RETRY_INTENT: "variant=\"border\" (the one retry look)",
})

/**
 * The new look of an expression: a string literal through the map, a conditional of mappable branches branch by branch. `null` when it cannot
 * decide (an identifier, a call, a template with substitutions, an unknown literal).
 */
export const mapVariantExpression = (ts: typeof Compiler, sf: Ts.SourceFile, x: Ts.Expression, map: Readonly<Record<string, string>> = BUTTON_VARIANT_MAP): string | null => {
    let e = x
    while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) e = e.expression
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
        const to = map[e.text]
        return to === undefined ? null : `"${to}"`
    }
    if (ts.isConditionalExpression(e)) {
        const yes = mapVariantExpression(ts, sf, e.whenTrue, map)
        const no = mapVariantExpression(ts, sf, e.whenFalse, map)
        if (yes === null || no === null) return null
        return yes === no ? yes : `${e.condition.getText(sf)} ? ${yes} : ${no}`
    }
    return null
}

/** The text of an attribute's value as a mapped JSX value: `"border"` or `{cond ? "primary" : "border"}`. */
const attrValue = (mapped: string): string => (mapped.startsWith("\"") && !mapped.includes("?") ? mapped : `{${mapped}}`)

/** The mapped look of an attribute: its literal or its expression, `null` when it cannot decide, `undefined` when absent. */
const lookOf = (ctx: StepContext, a: Ts.JsxAttribute | undefined, map: Readonly<Record<string, string>> = BUTTON_VARIANT_MAP): string | null | undefined => {
    if (a === undefined) return undefined
    const init = a.initializer
    if (init === undefined) return null
    if (ctx.ts.isStringLiteral(init)) {
        const to = map[init.text]
        return to === undefined ? null : `"${to}"`
    }
    const x = ctx.expression(a)
    return x === undefined ? null : mapVariantExpression(ctx.ts, ctx.sf, x, map)
}

/** `<Button>` and `<IconButton>`: intent, the old variant, step and a tone onto the one `variant`. */
const buttonVariant: ApiStep = {
    id: "button-variant",
    summary: "Button and IconButton take one variant: primary, border (default) or danger. intent, step and the vendor variants are deleted: commit is primary; neutral, alternative, dismiss, retry, secondary, tertiary, outline, ghost and flat are border; destructive, danger and danger-soft are danger; a toned Button is a toned primary",
    elements: ["Button", "IconButton"],
    apply: (ctx) => {
        const intent = ctx.attr("intent")
        const variant = ctx.attr("variant")
        const step = ctx.attr("step")
        const tone = ctx.name === "Button" ? ctx.attr("tone") : undefined
        if (intent === undefined && variant === undefined && step === undefined && tone === undefined) return
        const fromIntent = lookOf(ctx, intent)
        const fromVariant = lookOf(ctx, variant)
        const toneValue = ctx.literal(tone)
        const done: string[] = []
        // A tone: the colour of a primary; a danger tone is the danger look.
        if (tone !== undefined && toneValue === "danger") {
            ctx.drop(tone)
            done.push("tone=\"danger\" is variant=\"danger\"")
        }
        const toned = tone !== undefined && toneValue !== "danger"
        const decided = toneValue === "danger" ? "\"danger\"" : toned ? "\"primary\"" : fromIntent !== undefined ? fromIntent : fromVariant
        if (step !== undefined) {
            ctx.drop(step)
            done.push("step dropped")
        }
        if (decided === null || decided === undefined) {
            if (intent !== undefined || variant !== undefined) ctx.mark("the look is not a literal: set variant to primary (the one main action), border (any other) or danger (destructive)", BUTTON_MARK)
            if (done.length) ctx.changed(done.join(", "))
            return
        }
        const text = `variant=${attrValue(decided)}`
        let wrote = true
        if (intent !== undefined) {
            ctx.replace(intent, text)
            if (variant !== undefined) ctx.drop(variant)
        } else if (variant !== undefined) {
            if (variant.getText(ctx.sf) !== text) ctx.replace(variant, text)
            else wrote = false
        } else if (tone !== undefined && toneValue !== "danger") {
            // A tone with no look: the primary goes before the tone.
            ctx.edit(tone.getStart(ctx.sf), tone.getStart(ctx.sf), `${text} `)
        } else if (tone !== undefined) {
            ctx.edit(tone.getFullStart(), tone.getFullStart(), ` ${text}`)
        } else {
            wrote = false
        }
        if (wrote) done.unshift(text)
        if (done.length) ctx.changed(done.join(", "))
    },
}

/** `<EmptyNotice actionIntent>` is `actionVariant`. */
const emptyNoticeActionVariant: ApiStep = {
    id: "empty-notice-action-variant",
    summary: "<EmptyNotice actionIntent> is actionVariant: commit is primary, neutral is border",
    elements: ["EmptyNotice"],
    apply: (ctx) => {
        const a = ctx.attr("actionIntent")
        if (a === undefined) return
        const mapped = lookOf(ctx, a, INTENT_MAP)
        if (mapped === null || mapped === undefined || mapped.includes("danger")) return ctx.mark("actionIntent is not a literal commit or neutral: set actionVariant to primary or border", BUTTON_MARK)
        const text = `actionVariant=${attrValue(mapped)}`
        ctx.replace(a, text)
        ctx.changed(text)
    },
}

/** The JSX steps of the Button pass, in the order they run. */
export const BUTTON_STEPS: readonly ApiStep[] = [buttonVariant, emptyNoticeActionVariant]

/** One edit of a source span. */
interface PropertyEdit {
    readonly pos: number
    readonly end: number
    readonly text: string
}

/**
 * An action object's `intent: "<literal>"` (in a file that imports the Grammar): `variant: "<look>"`, and its `isPrimary` dropped. A non-literal intent is
 * marked. Returns the edits and, when it changed or marked anything, the finding's text.
 */
export const rewriteIntentProperty = (ts: typeof Compiler, sf: Ts.SourceFile, n: Ts.PropertyAssignment): { readonly edits: readonly PropertyEdit[]; readonly after?: string; readonly reason?: string } | undefined => {
    if (!(ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) || n.name.text !== "intent") return undefined
    if (!ts.isObjectLiteralExpression(n.parent)) return undefined
    const mapped = mapVariantExpression(ts, sf, n.initializer, INTENT_MAP)
    if (mapped === null) {
        // Only an object that reads as an action (it has a label) is marked: `intent` is a common word.
        const isAction = n.parent.properties.some((p) => p.name !== undefined && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === "label")
        if (!isAction) return undefined
        return { edits: [], reason: "the action's intent is not a literal: set variant to primary, border or danger" }
    }
    const edits: PropertyEdit[] = [{ pos: n.getStart(sf), end: n.getEnd(), text: `variant: ${mapped}` }]
    for (const p of n.parent.properties) {
        if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === "isPrimary") {
            const list = n.parent.properties
            const i = list.indexOf(p)
            // The property and the comma that joins it to its neighbour.
            const pos = i > 0 ? (list[i - 1] as Ts.Node).getEnd() : p.getStart(sf)
            const end = i > 0 ? p.getEnd() : (list[i + 1]?.getStart(sf) ?? p.getEnd())
            edits.push({ pos, end, text: "" })
        }
    }
    return { edits, after: `variant: ${mapped}` }
}
