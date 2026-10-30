import { formatTable } from "../shared/output.js"
import { RETIRED_FLAGS, RETIRED_VERBS, retiredOf } from "../shared/retired.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb, spellingOf } from "../shared/verb.js"
import type { AnyVerb, Edition, Effect, FlagSpec, Role } from "../shared/verb.js"

interface FlagEntry {
    readonly name: string
    readonly kind: string
    readonly required: boolean
    readonly positional: boolean
    readonly summary: string
}

interface VerbEntry {
    readonly command: string
    readonly summary: string
    readonly editions: readonly Edition[]
    readonly effect: Effect
    readonly roles: readonly Role[]
    readonly schema: string
    readonly flags: readonly FlagEntry[]
    /** Whether @starci/hfs owns the verb's flags and help (`starci app <verb> --help` prints them). */
    readonly forwarded: boolean
    /** The retired spellings that now run as this verb (shared/retired.ts). */
    readonly retired: readonly string[]
}

/** A retired spelling the term names: the old spelling, what it runs as now (null: removed), and the line that says what to type. */
interface RetiredEntry {
    readonly old: string
    readonly now: string | null
    readonly recovery: string
}

interface ExplainData {
    readonly tree: string
    readonly verbs: readonly VerbEntry[]
    readonly retired: readonly RetiredEntry[]
}

const flagsOf = (flags: Readonly<Record<string, FlagSpec>>): FlagEntry[] =>
    Object.entries(flags).map(([name, spec]) => ({ name, kind: spec.kind, required: spec.required === true, positional: spec.positional === true || spec.kind === "rest", summary: spec.summary }))

/** One flag as the help line spells it: `--name <value>`, `<operand>`, `[operand...]`. */
const flagSpelling = (flag: FlagEntry): string => {
    if (flag.kind === "rest") return flag.required ? `<${flag.name}...>` : `[${flag.name}...]`
    if (flag.positional) return flag.required ? `<${flag.name}>` : `[${flag.name}]`
    const value = flag.kind === "boolean" ? "" : " <value>"
    return `--${flag.name}${value}${flag.kind === "list" ? " (repeatable)" : ""}${flag.required ? " (required)" : ""}`
}

const entryOf = (verb: AnyVerb): VerbEntry => ({
    command: `starci ${spellingOf(verb)}`,
    summary: verb.summary,
    editions: verb.editions,
    effect: verb.effect,
    roles: verb.roles,
    schema: verb.schema,
    flags: flagsOf(verb.flags),
    forwarded: verb.forward === true,
    retired: retiredOf(spellingOf(verb)),
})

/** The lines `explain <term>` prints under a verb: each flag, then the retired spellings it answers. */
const detailOf = (verb: VerbEntry): string[] => [
    `${verb.command}  (${verb.effect})  ${verb.summary}`,
    ...verb.flags.map((flag) => `    ${flagSpelling(flag)}  ${flag.summary}`),
    ...(verb.forwarded ? [`    every argument is @starci/hfs's: ${verb.command} --help prints its flags`] : []),
    ...verb.retired.map((line) => `    retired: ${line}`),
]

/**
 * `starci explain [term]`: the verbs this build offers for the current tree, from their one definition (every flag with its
 * help line, the same table commander's `--help` is built from) and the retired spellings that map to them (shared/retired.ts).
 * A term narrows the list to the verbs whose command or summary holds it and prints each one's flags; a term naming a retired
 * spelling prints what it runs as now.
 */
export const explainVerb = defineVerb({
    path: ["explain"],
    summary: "list the verbs available here with their flags, effect and json schema; a search term narrows the list and prints each verb's flags and retired spellings",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/explain@1",
    flags: {
        term: { kind: "string", positional: true, summary: "only verbs whose command or summary contains this text, each with its flags" },
    },
    run: (context, flags) => {
        const term = flags.term?.toLowerCase()
        const verbs = context.verbs.filter((verb) => term === undefined || `${spellingOf(verb)} ${verb.summary}`.toLowerCase().includes(term)).map(entryOf)
        const retired: RetiredEntry[] =
            term === undefined
                ? []
                : [
                      ...RETIRED_VERBS.map((row) => ({ old: row.old.join(" "), now: row.now === null ? null : [...row.now, ...(row.adds ?? [])].join(" "), recovery: row.recovery })),
                      ...RETIRED_FLAGS.map((row) => ({ old: `${row.verb} ${row.old}`, now: row.now === null ? row.verb : `${row.verb} ${row.now}`, recovery: row.recovery })),
                  ].filter((row) => row.old.toLowerCase().includes(term))
        const data: ExplainData = { tree: context.tree, verbs, retired }
        if (term === undefined) {
            const table = formatTable([["COMMAND", "EFFECT", "SUMMARY"], ...verbs.map((verb) => [verb.command, verb.effect, verb.summary])])
            return Promise.resolve({ data, message: `tree: ${context.tree}\n${table}` })
        }
        const lines = [`tree: ${context.tree}`, ...verbs.flatMap(detailOf), ...retired.map((row) => `retired: starci ${row.old} -> ${row.now === null ? "removed" : `starci ${row.now}`}: ${row.recovery}`)]
        return Promise.resolve({ data, message: verbs.length === 0 && retired.length === 0 ? `tree: ${context.tree}\nno verb matches ${String(flags.term)}` : lines.join("\n") })
    },
})
