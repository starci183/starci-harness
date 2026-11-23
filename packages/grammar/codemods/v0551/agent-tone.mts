/**
 * v0551, the tone slot (owner 2026-11-23 "Chuyển về NIVO"): the agent tones the 0.55.1 dev line had added to the Grammar are deleted, because which
 * colour an agent wears is the app's palette; the Grammar takes a soft pair by slot (`tone={{ soft, ink }}`) instead. This pass rewrites:
 *
 * - `tone="agent"` on a Grammar element to `tone={agentTone(<its seed, else its name>)}`;
 * - a call `agentToneOf(x)` of the Grammar's to `agentTone(x)`;
 * - and drops `agentToneOf`, `AGENT_TONES`, `isAgentTone` and `AgentTone` from the Grammar import, marking it once
 *   `// TODO(grammar-0.55.1): import agentTone ...`: `agentTone` is the app's own helper (a stable hash of the key to one of its own `{ soft, ink }` pairs).
 *
 * A Grammar `Avatar` (or an `AvatarGroup` item) with `kind="agent"` and no `tone` drew its agent tone by itself on the dev line; it is the generated
 * colour again. Those are listed, not rewritten: only the app knows whether it wants its own tone there.
 */
import type * as Ts from "typescript"
import type Compiler from "typescript"
import { grammarBindings, grammarElementName } from "../v0550/api.mts"

/** The marker of a case left for a person. */
export const AGENT_TONE_MARK = "TODO(grammar-0.55.1)"

/** The app helper the rewrite calls. */
export const APP_HELPER = "agentTone"

/** The Grammar exports deleted with the agent tones. */
export const DELETED_AGENT_EXPORTS: readonly string[] = Object.freeze(["agentToneOf", "AGENT_TONES", "isAgentTone", "AgentTone"])

/** The note above the Grammar import that lost an agent export. */
export const IMPORT_NOTE = `// ${AGENT_TONE_MARK}: import ${APP_HELPER} from the app's own palette: the Grammar's agent tones are deleted; ${APP_HELPER}(key) returns a { soft, ink } tone slot`

export interface AgentToneFinding {
    readonly file: string
    readonly line: number
    readonly reason: string
    readonly before: string
}

type Edit = { readonly start: number; readonly end: number; readonly text: string }

/** Rewrite one source. Idempotent: a second run finds nothing to change. */
export function transformAgentTone(ts: typeof Compiler, file: string, original: string): { readonly text: string; readonly findings: readonly AgentToneFinding[] } {
    const findings: AgentToneFinding[] = []
    if (!original.includes("@starci/grammar")) return { text: original, findings }
    const sf = ts.createSourceFile(file, original, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const bindings = grammarBindings(ts, sf)
    const lineOf = (pos: number): number => sf.getLineAndCharacterOfPosition(pos).line + 1
    const edits: Edit[] = []
    let needsHelper = false
    // local names of the Grammar's agentToneOf (an alias included)
    const toneOfNames = new Set([...bindings.named].filter(([, exported]) => exported === "agentToneOf").map(([local]) => local))

    const visit = (n: Ts.Node): void => {
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && toneOfNames.has(n.expression.text)) {
            edits.push({ start: n.expression.getStart(sf), end: n.expression.end, text: APP_HELPER })
            findings.push({ file, line: lineOf(n.getStart(sf)), reason: `agentToneOf is deleted; ${APP_HELPER} is the app's`, before: n.getText(sf).slice(0, 120) })
            needsHelper = true
        }
        if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && grammarElementName(ts, bindings, n) !== undefined) {
            const attrs = n.attributes.properties.filter(ts.isJsxAttribute)
            const attr = (name: string) => attrs.find((a) => a.name.getText(sf) === name)
            const expr = (a: Ts.JsxAttribute | undefined): string | undefined => {
                const init = a?.initializer
                if (init === undefined) return undefined
                if (ts.isStringLiteral(init)) return JSON.stringify(init.text)
                if (ts.isJsxExpression(init) && init.expression !== undefined) return init.expression.getText(sf)
                return undefined
            }
            const tone = attr("tone")
            if (tone?.initializer !== undefined && ts.isStringLiteral(tone.initializer) && tone.initializer.text === "agent") {
                const key = expr(attr("seed")) ?? expr(attr("name"))
                if (key === undefined) {
                    findings.push({ file, line: lineOf(tone.getStart(sf)), reason: `tone="agent" is deleted and the element names no seed or name: pass tone={${APP_HELPER}(key)}`, before: n.getText(sf).split("\n")[0]?.slice(0, 120) ?? "" })
                } else {
                    edits.push({ start: tone.getStart(sf), end: tone.end, text: `tone={${APP_HELPER}(${key})}` })
                    findings.push({ file, line: lineOf(tone.getStart(sf)), reason: `tone="agent" is deleted; the app's ${APP_HELPER} gives the slot`, before: tone.getText(sf) })
                    needsHelper = true
                }
            } else if (tone === undefined && grammarElementName(ts, bindings, n) === "Avatar" && expr(attr("kind")) === "\"agent\"" && attr("src") === undefined && attr("mark") === undefined) {
                findings.push({ file, line: lineOf(n.getStart(sf)), reason: `an agent's Avatar no longer wears an agent tone by itself; pass tone={${APP_HELPER}(key)} to keep one`, before: n.getText(sf).split("\n")[0]?.slice(0, 120) ?? "" })
            }
        }
        ts.forEachChild(n, visit)
    }
    visit(sf)

    for (const st of sf.statements) {
        if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !st.moduleSpecifier.text.startsWith("@starci/grammar")) continue
        const named = st.importClause?.namedBindings
        if (named === undefined || !ts.isNamedImports(named)) continue
        const dropped = named.elements.filter((spec) => DELETED_AGENT_EXPORTS.includes((spec.propertyName ?? spec.name).text))
        if (dropped.length === 0) continue
        const kept = named.elements.filter((spec) => !dropped.includes(spec)).map((spec) => spec.getText(sf))
        const hasDefault = st.importClause?.name !== undefined
        const start = st.getStart(sf)
        const note = original.slice(Math.max(0, start - IMPORT_NOTE.length - 2), start).includes(IMPORT_NOTE) ? "" : `${IMPORT_NOTE}\n`
        if (kept.length === 0 && !hasDefault) edits.push({ start, end: st.end, text: note.trimEnd() })
        else {
            edits.push({ start: named.getStart(sf), end: named.end, text: `{ ${kept.join(", ")} }` })
            if (note !== "") edits.push({ start, end: start, text: note })
        }
        needsHelper = false
        findings.push({ file, line: lineOf(start), reason: `${dropped.map((spec) => spec.getText(sf)).join(", ")} dropped from the Grammar import`, before: st.getText(sf).slice(0, 120) })
    }
    // tone="agent" rewritten in a file that imported no agent export: the helper still has to come from the app
    if (needsHelper && !original.includes(IMPORT_NOTE)) {
        const first = sf.statements.find((st) => ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.moduleSpecifier.text.startsWith("@starci/grammar"))
        if (first !== undefined) edits.push({ start: first.getStart(sf), end: first.getStart(sf), text: `${IMPORT_NOTE}\n` })
    }

    let text = original
    for (const edit of [...edits].sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end)
    return { text, findings }
}
