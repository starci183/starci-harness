/** Which product edition a verb serves; a verb of both editions is a core verb. */
export type Edition = "lite" | "full"

/** The tree the command runs against: an app of one edition, the runtime itself, or no StarCi tree. */
export type TreeKind = Edition | "runtime" | "none"

/** What a verb is allowed to touch; it decides whether an agent may run it without the owner. */
export type Effect = "read" | "local-write" | "host" | "remote" | "publish"

/** Who may run a verb. */
export type Role = "owner" | "release" | "coordinator" | "lead" | "worker" | "agent" | "kernel" | "supervisor" | "op" | "debug"

/**
 * One flag of a verb: its spelling, kind and help line. A `rest` flag is the verb's last operands, typed after its positional
 * (`starci uat run <script> -- <args...>`), handed over as they were.
 */
export interface FlagSpec extends PositionalFlag {
    readonly kind: "boolean" | "string" | "rest"
    readonly summary: string
    readonly required?: boolean
}

/** A flag that is given as the verb's positional argument (`starci contract check <file>`) instead of `--file`. */
export interface PositionalFlag {
    readonly positional?: true
}

/** The typed values of a verb's flags, derived from its flag specs. */
export type FlagValues<F extends Readonly<Record<string, FlagSpec>>> = {
    readonly [K in keyof F]: F[K]["kind"] extends "boolean"
        ? boolean
        : F[K]["kind"] extends "rest"
          ? readonly string[]
          : F[K]["required"] extends true
          ? string
          : string | undefined
}

/** What every handler receives: where it runs, which tree it sees and the verbs of this build. */
export interface VerbContext {
    readonly cwd: string
    readonly tree: TreeKind
    readonly treeRoot: string | undefined
    readonly verbs: readonly AnyVerb[]
    /** Prints one progress line as it happens (a long-running verb's live log); silent under --json, whose one envelope comes at the end. */
    readonly progress: (line: string) => void
}

/** A handler's answer: the json data, the human message, and a non-zero exit when the verb's own verdict is red (a failed lint) while its report is still printed. */
export interface VerbResult<T> {
    readonly data: T
    readonly message: string
    readonly exitCode?: number
}

/** The single definition of a verb: catalog metadata and handler in one object, so help, docs and json never drift. */
export interface VerbDefinition<T, F extends Readonly<Record<string, FlagSpec>>> {
    readonly path: readonly [string] | readonly [string, string]
    readonly summary: string
    readonly editions: readonly Edition[]
    readonly effect: Effect
    readonly roles: readonly Role[]
    readonly schema: `starci/${string}@${number}`
    readonly flags: F
    readonly run: (context: VerbContext, flags: FlagValues<F>) => Promise<VerbResult<T>>
}

/** The flag values the command line hands an erased verb. */
export type RawFlagValues = Readonly<Record<string, string | boolean | readonly string[] | undefined>>

/** Any verb, erased for the registry and the catalog: its handler takes the raw flag values main parsed. */
export interface AnyVerb extends Omit<VerbDefinition<unknown, Readonly<Record<string, FlagSpec>>>, "run"> {
    readonly run: (context: VerbContext, flags: RawFlagValues) => Promise<VerbResult<unknown>>
}

/** Declares one verb; the identity function only fixes the generic types at the definition site. */
export const defineVerb = <T, F extends Readonly<Record<string, FlagSpec>>>(
    definition: VerbDefinition<T, F>,
): VerbDefinition<T, F> => definition

/** The editions a core verb serves. */
export const BOTH_EDITIONS: readonly Edition[] = ["lite", "full"]

/** The roles that may run a read-only verb: every role, the harness's own (kernel, supervisor, op, debug) included. */
export const EVERYONE: readonly Role[] = ["owner", "release", "coordinator", "lead", "worker", "agent", "kernel", "supervisor", "op", "debug"]

/** The roles that may run a local-write verb open to all: everyone but debug, which never runs a writing verb. */
export const WRITERS: readonly Role[] = EVERYONE.filter((role) => role !== "debug")

/** The command spelling of a verb, e.g. `release ci-status`. */
export const spellingOf = (verb: AnyVerb): string => verb.path.join(" ")
