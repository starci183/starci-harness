import { formatTable } from "../shared/output.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb, spellingOf } from "../shared/verb.js"
import type { Edition, Effect, Role } from "../shared/verb.js"

interface VerbEntry {
    readonly command: string
    readonly summary: string
    readonly editions: readonly Edition[]
    readonly effect: Effect
    readonly roles: readonly Role[]
    readonly schema: string
    readonly flags: readonly { readonly name: string; readonly kind: string; readonly required: boolean; readonly summary: string }[]
}

interface ExplainData {
    readonly tree: string
    readonly verbs: readonly VerbEntry[]
}

const flagsOf = (flags: Readonly<Record<string, { kind: string; summary: string; required?: boolean }>>): VerbEntry["flags"] =>
    Object.entries(flags).map(([name, spec]) => ({ name, kind: spec.kind, required: spec.required === true, summary: spec.summary }))

/** `starci explain [term]`: the verbs this build offers for the current tree, from their one definition. */
export const explainVerb = defineVerb({
    path: ["explain"],
    summary: "list the verbs available here with their flags, effect and json schema; filter by a search term",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/explain@1",
    flags: {
        term: { kind: "string", summary: "only verbs whose command or summary contains this text" },
    },
    run: (context, flags) => {
        const term = flags.term?.toLowerCase()
        const verbs = context.verbs
            .filter((verb) => term === undefined || `${spellingOf(verb)} ${verb.summary}`.toLowerCase().includes(term))
            .map(
                (verb): VerbEntry => ({
                    command: `starci ${spellingOf(verb)}`,
                    summary: verb.summary,
                    editions: verb.editions,
                    effect: verb.effect,
                    roles: verb.roles,
                    schema: verb.schema,
                    flags: flagsOf(verb.flags),
                }),
            )
        const data: ExplainData = { tree: context.tree, verbs }
        const table = formatTable([["COMMAND", "EFFECT", "SUMMARY"], ...verbs.map((verb) => [verb.command, verb.effect, verb.summary])])
        return Promise.resolve({ data, message: `tree: ${context.tree}\n${table}` })
    },
})
