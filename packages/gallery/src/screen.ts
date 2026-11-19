// The screen.yaml of a gallery screen (PROJECT-GALLERY-8; the schema is packages/hfs/runtime/scripts/hfs/screen-yaml.mts, which the gate runs): identity, sections, the options
// considered and the UI audit. This is the tolerant reader the app draws from, in plain TypeScript (the browser cannot import the validator): it keeps what is well formed
// and never throws, `starci app check` is the one that judges the file.
import { UNCLEAR_VALUE } from "./explain.ts"
import type { Explain, Region } from "./explain.ts"

/** The seven lenses of the UI audit, in order. */
export const LENSES = ["order", "layout", "actionable", "live", "words", "states", "truth"] as const
export type Lens = (typeof LENSES)[number]
export type Verdict = "pass" | "fixed" | "open"
export const MIN_ROUNDS = 2
export const MAX_ROUNDS = 4

export interface ScreenSection {
    readonly id: string
    readonly title: string
    readonly shows: string
    readonly why: string
    readonly actions: readonly string[]
    /** state name to its text (null: the state is not drawn). */
    readonly states: readonly (readonly [string, string | null])[]
    readonly needsApi: readonly string[]
    readonly law: string
    readonly grammar: string
}
export interface ScreenConsidered {
    readonly option: string
    readonly chosen: boolean
    readonly why: string
}
export interface ScreenRound {
    readonly n: number
    readonly at: string
    readonly lenses: Readonly<Record<Lens, { readonly verdict: Verdict; readonly notes: string }>>
}
export interface ScreenAudit {
    readonly builder: string
    readonly auditor: string
    readonly rounds: readonly ScreenRound[]
    readonly escalate: string | null
}
export interface ScreenDoc {
    readonly title: string
    readonly route: string
    readonly summary: string
    readonly code: readonly string[]
    readonly sections: readonly ScreenSection[]
    readonly considered: readonly ScreenConsidered[]
    /** null: not audited yet (grandfathered). */
    readonly audit: ScreenAudit | null
}

const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "")
const strs = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [])

function readAudit(value: unknown): ScreenAudit | null {
    if (!plain(value)) return null
    const agent = (side: unknown): string => (plain(side) ? str(side.agent) : "")
    const rounds: ScreenRound[] = (Array.isArray(value.rounds) ? value.rounds : []).filter(plain).map((round, index) => {
        const lenses = plain(round.lenses) ? round.lenses : {}
        const read = (lens: Lens): { verdict: Verdict; notes: string } => {
            const entry = plain(lenses[lens]) ? lenses[lens] : {}
            const verdict = entry.verdict
            return { verdict: verdict === "pass" || verdict === "fixed" || verdict === "open" ? verdict : "open", notes: str(entry.notes) }
        }
        return {
            n: typeof round.n === "number" ? round.n : index + 1,
            at: round.at instanceof Date ? round.at.toISOString() : str(round.at),
            lenses: Object.fromEntries(LENSES.map((lens) => [lens, read(lens)])) as ScreenRound["lenses"],
        }
    })
    return { builder: agent(value.builder), auditor: agent(value.auditor), rounds, escalate: str(value.escalate) === "" ? null : str(value.escalate) }
}

/** The document of a parsed screen.yaml value; null when it is not a mapping. */
export function readScreen(value: unknown): ScreenDoc | null {
    if (!plain(value)) return null
    const sections: ScreenSection[] = (Array.isArray(value.sections) ? value.sections : []).filter(plain).map((section) => ({
        id: str(section.id),
        title: str(section.title) || str(section.id),
        shows: str(section.shows),
        why: str(section.why),
        actions: strs(section.actions),
        states: plain(section.states) ? Object.entries(section.states).map(([name, text]) => [name, typeof text === "string" && text.trim() !== "" ? text.trim() : null] as const) : [],
        needsApi: strs(section.needsApi),
        law: str(section.law),
        grammar: str(section.grammar),
    }))
    const considered: ScreenConsidered[] = (Array.isArray(value.considered) ? value.considered : []).filter(plain).map((entry) => ({ option: str(entry.option), chosen: entry.chosen === true, why: str(entry.why) }))
    return { title: str(value.title), route: str(value.route), summary: str(value.summary), code: strs(value.code), sections, considered, audit: readAudit(value.audit) }
}

/** The explanation the older flags know (a region lacking Vì sao, or saying CHƯA RÕ / SAI) built from a document: one region per section. */
export function explainOf(doc: ScreenDoc): Explain {
    const regions: Region[] = doc.sections.map((section) => {
        const fields: Region["fields"] = { "Vì sao": section.why }
        if (section.law !== "") fields["Luật"] = section.law
        if (section.grammar !== "") fields.Grammar = section.grammar
        const problems: Region["problems"] = section.why === "" ? [{ kind: "missing", field: "Vì sao" }] : UNCLEAR_VALUE.test(section.why) ? [{ kind: "unclear", field: "Vì sao" }] : []
        return { name: section.title, fields, problems }
    })
    return { meta: { title: doc.title, route: doc.route }, intro: "", regions }
}

/** Why the audit of a screen needs attention: it has none, fewer than two rounds, or the latest round still has an open lens. Empty when it stands. */
export interface AuditFlag {
    readonly kind: "none" | "few" | "open" | "owner"
    readonly open: readonly Lens[]
}
export function auditFlag(doc: ScreenDoc | null): AuditFlag | null {
    if (doc === null) return null
    const audit = doc.audit
    if (audit === null) return { kind: "none", open: [] }
    const last = audit.rounds.at(-1)
    const open = last === undefined ? [] : LENSES.filter((lens) => last.lenses[lens].verdict === "open")
    if (audit.escalate !== null) return { kind: "owner", open }
    if (open.length > 0) return { kind: "open", open }
    if (audit.rounds.length < MIN_ROUNDS) return { kind: "few", open }
    return null
}
