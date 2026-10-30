import { EXIT_USAGE, Refusal } from "./errors.js"

/**
 * Whether a retired spelling is refused. Off, the parser accepts it, rewrites it to its new spelling and prints one notice on
 * stderr naming the new one; on, it refuses it with the row's code and recovery line. The owner turns it on once the app
 * nivo-lite has deployed on the new spellings (ruling cli-canonical-2026-10-30, contexts/harness/cli-canonical.md); a removed
 * verb (`now` null) has nothing to map to and is refused either way.
 */
export const REFUSE_RETIRED_SPELLINGS = false

/** A retired flag of one verb: its old spelling, the new one (null: dropped, effects being dry by default), how its value moves. */
export interface RetiredFlag {
    readonly old: string
    readonly now: string | null
    /** Whether the old flag takes a value (the next token, or `--old=value`). */
    readonly value: boolean
    /** Divides a numeric value on the way (milliseconds to seconds: 1000). */
    readonly divide?: number
}

/** A retired verb path: the spelling that replaces it (null: removed), the flags it adds, and its own flag renames. */
export interface RetiredVerb {
    readonly old: readonly [string, string]
    readonly now: readonly string[] | null
    /** Tokens added after the new path (`--loop`, `--kind feedback`). */
    readonly adds?: readonly string[]
    /** The flag the old verb's first operand becomes (`feedback add <words>` gives `--title <words>`). */
    readonly operand?: string
    /** Flags of the old verb renamed on the way, applied before `adds` so an added flag is never renamed. */
    readonly flags?: readonly RetiredFlag[]
    readonly code: string
    readonly recovery: string
}

/** The retired flags of one canonical verb, each with its refusal code and recovery line. */
export interface RetiredFlagRow extends RetiredFlag {
    readonly verb: string
    readonly code: string
    readonly recovery: string
}

const DRY = "effects are dry by default; add --execute to act"

/** Every retired verb spelling: one row each, read by the parser (`rewriteRetired`), `starci explain` and each verb's help. */
export const RETIRED_VERBS: readonly RetiredVerb[] = [
    { old: ["release", "ci-status"], now: ["check", "ci"], code: "VERB_RETIRED", recovery: "starci check ci [--sha <sha>] (its --json prints the verdict; it exits 0 only on green)" },
    { old: ["workflow", "run"], now: ["workflow", "step"], adds: ["--loop"], code: "VERB_RETIRED", recovery: "starci workflow step <id> --loop [--interval <s>] [--until done|blocked|idle] [--max-ticks <n>]" },
    { old: ["workflow", "regoal"], now: ["workflow", "amend"], code: "VERB_RETIRED", recovery: "starci workflow amend <id> --goal <goal-change file> --based-on <goal version>" },
    { old: ["supervisor", "watch"], now: ["supervisor", "tick"], adds: ["--loop", "--execute"], code: "VERB_RETIRED", recovery: "starci supervisor tick --loop --execute [--ticks <n>]" },
    { old: ["supervisor", "telegram-bridge"], now: ["connect", "telegram", "bridge"], code: "VERB_RETIRED", recovery: "starci connect telegram bridge <run|status> [--once]" },
    { old: ["route", "explain"], now: ["route", "show"], code: "VERB_RETIRED", recovery: "starci route show --label <label> [--difficulty <d>] [--risk <tags>]" },
    { old: ["feedback", "add"], now: ["ticket", "open"], adds: ["--kind", "feedback"], operand: "--title", code: "VERB_RETIRED", recovery: 'starci ticket open --kind feedback --title "<the owner\'s words>" [--on <day>] [--id <id>]' },
    {
        old: ["feedback", "close"],
        now: ["ticket", "close"],
        adds: ["--kind", "feedback"],
        flags: [{ old: "--kind", now: "--target-kind", value: true }],
        code: "VERB_RETIRED",
        recovery: "starci ticket close <id> --kind feedback --target-kind <grammar|cli|app|rule|context> --target <target>",
    },
    { old: ["feedback", "list"], now: ["ticket", "list"], adds: ["--kind", "feedback"], code: "VERB_RETIRED", recovery: "starci ticket list --kind feedback [--status open|closed|all|overdue]" },
    { old: ["feedback", "check"], now: ["ticket", "list"], adds: ["--kind", "feedback", "--status", "overdue"], code: "VERB_RETIRED", recovery: "starci ticket list --kind feedback --status overdue (exit 1 on an overdue item or a target gone)" },
    { old: ["check", "stories"], now: null, code: "VERB_REMOVED", recovery: "nothing replaces it; no caller remained" },
    { old: ["check", "typecheck"], now: null, code: "VERB_REMOVED", recovery: "starci check run runs the typecheck of the changed packages with the other runtime gates" },
]

/** Every retired flag spelling of a canonical verb. */
export const RETIRED_FLAGS: readonly RetiredFlagRow[] = [
    { verb: "release push", old: "--dry-run", now: null, value: false, code: "FLAG_RETIRED", recovery: `${DRY}: starci release push [--execute]` },
    { verb: "release cut", old: "--dry-run", now: null, value: false, code: "FLAG_RETIRED", recovery: `${DRY}: starci release cut [--execute]` },
    { verb: "release publish", old: "--publish", now: "--execute", value: false, code: "FLAG_RETIRED", recovery: "starci release publish --execute" },
    { verb: "release affected", old: "--head", now: "--sha", value: true, code: "FLAG_RETIRED", recovery: "starci release affected --sha <sha>" },
    { verb: "contract new", old: "--cwd-path", now: "--cwd", value: true, code: "FLAG_RETIRED", recovery: "starci contract new --cwd <repository folder>" },
    { verb: "contract new", old: "--details", now: "--note", value: true, code: "FLAG_RETIRED", recovery: 'starci contract new --note "<more words on the input>"' },
    { verb: "task send", old: "--timeout-ms", now: "--timeout", value: true, divide: 1000, code: "FLAG_RETIRED", recovery: "starci task send --timeout <seconds>" },
    { verb: "seat start", old: "--dry-run", now: null, value: false, code: "FLAG_RETIRED", recovery: `${DRY}: starci seat start <task> [--execute]` },
    { verb: "seat start", old: "--timeout-ms", now: "--timeout", value: true, divide: 1000, code: "FLAG_RETIRED", recovery: "starci seat start --timeout <seconds>" },
    { verb: "project park", old: "--dry-run", now: null, value: false, code: "FLAG_RETIRED", recovery: `${DRY}: starci project park [--execute]` },
    { verb: "supervisor tick", old: "--dry-run", now: null, value: false, code: "FLAG_RETIRED", recovery: `${DRY}: starci supervisor tick [--execute]` },
    { verb: "worktree gc", old: "--dry-run", now: null, value: false, code: "FLAG_RETIRED", recovery: `${DRY}: starci worktree gc [--execute]` },
    { verb: "host install", old: "--dry", now: null, value: false, code: "FLAG_RETIRED", recovery: `${DRY}: starci host install [--execute]` },
    { verb: "host uninstall", old: "--dry", now: null, value: false, code: "FLAG_RETIRED", recovery: `${DRY}: starci host uninstall [--execute]` },
    { verb: "uat run", old: "--timeout-ms", now: "--timeout", value: true, divide: 1000, code: "FLAG_RETIRED", recovery: "starci uat run --timeout <seconds>" },
    { verb: "dna check", old: "--wait", now: "--timeout", value: true, divide: 1000, code: "FLAG_RETIRED", recovery: "starci dna check --timeout <seconds>" },
    { verb: "deps check", old: "--revision", now: "--sha", value: true, code: "FLAG_RETIRED", recovery: "starci deps check --sha <sha>" },
    { verb: "deps source", old: "--from", now: "--cwd", value: true, code: "FLAG_RETIRED", recovery: "starci deps source --local --cwd <folder of the @starci package folders>" },
    { verb: "pkg branch", old: "--harness", now: "--cwd", value: true, code: "FLAG_RETIRED", recovery: "starci pkg branch --cwd <harness repository>" },
    { verb: "pkg test", old: "--harness", now: "--cwd", value: true, code: "FLAG_RETIRED", recovery: "starci pkg test --cwd <harness repository>" },
    { verb: "provider report", old: "--detail", now: "--reason", value: true, code: "FLAG_RETIRED", recovery: 'starci provider report <provider> --reason "<the provider\'s words>"' },
    { verb: "budget raise", old: "--by", now: null, value: true, code: "FLAG_RETIRED", recovery: "drop --by: the caller's role (STARCI_ROLE) is who raises" },
    { verb: "ticket list", old: "--state", now: "--status", value: true, code: "FLAG_RETIRED", recovery: "starci ticket list --status <state>" },
    { verb: "ticket answer", old: "--why", now: "--reason", value: true, code: "FLAG_RETIRED", recovery: 'starci ticket answer <id> --reason "<why>"' },
    { verb: "contexts anatomy", old: "--check", now: null, value: false, code: "FLAG_RETIRED", recovery: "starci contexts anatomy (the dry run judges and exits 1 on drift)" },
    { verb: "contexts anatomy", old: "--write", now: "--execute", value: false, code: "FLAG_RETIRED", recovery: "starci contexts anatomy --execute" },
    { verb: "contexts anchor", old: "--check", now: null, value: false, code: "FLAG_RETIRED", recovery: "starci contexts anchor (with no id it judges the anchors and exits 1 on a duplicate or dangling one)" },
    { verb: "contexts anchor", old: "--root", now: "--cwd", value: true, code: "FLAG_RETIRED", recovery: "starci contexts anchor --cwd <tree>" },
    { verb: "contexts search", old: "--check", now: null, value: false, code: "FLAG_RETIRED", recovery: "starci contexts search (with no question it judges the index and exits 1 when stale)" },
    { verb: "contexts search", old: "--root", now: "--cwd", value: true, code: "FLAG_RETIRED", recovery: "starci contexts search --cwd <tree>" },
]

/** What the parser made of a command line: the argv the verbs read, and one notice per retired spelling it mapped. */
export interface Rewritten {
    readonly argv: readonly string[]
    readonly notices: readonly string[]
}

/** The options the CLI itself takes before or after a verb (`--json`, `--cwd <dir>`), which are never a verb's path. */
const globalSpan = (tokens: readonly string[], at: number): number => {
    const token = tokens[at] ?? ""
    if (token === "--json" || token.startsWith("--cwd=")) return 1
    if (token === "--cwd") return 2
    return 0
}

/** The indexes of the first two operands (the verb path), skipping the CLI's own options; stops at the first other option. */
const pathIndexes = (tokens: readonly string[]): number[] => {
    const found: number[] = []
    let at = 0
    while (at < tokens.length && found.length < 2) {
        const span = globalSpan(tokens, at)
        if (span > 0) {
            at += span
            continue
        }
        if ((tokens[at] ?? "").startsWith("-")) break
        found.push(at)
        at += 1
    }
    return found
}

const scaled = (value: string, divide: number | undefined): string => (divide === undefined ? value : String(Number(value) / divide))

/** One flag rename over the tokens after the path; returns the tokens and whether the old spelling was there. */
const renameFlag = (tokens: readonly string[], flag: RetiredFlag): { readonly tokens: string[]; readonly hit: boolean } => {
    const out: string[] = []
    let hit = false
    for (let at = 0; at < tokens.length; at += 1) {
        const token = tokens[at] ?? ""
        const inline = flag.value && token.startsWith(`${flag.old}=`)
        if (token !== flag.old && !inline) {
            out.push(token)
            continue
        }
        hit = true
        if (!flag.value) {
            if (flag.now !== null) out.push(flag.now)
            continue
        }
        const value = inline ? token.slice(flag.old.length + 1) : tokens[at + 1]
        if (!inline) at += 1
        if (flag.now !== null) out.push(...(value === undefined ? [flag.now] : [flag.now, scaled(value, flag.divide)]))
    }
    return { tokens: out, hit }
}

/** The first operand after the path, not the value of a flag before it; its index or -1. */
const firstOperand = (tokens: readonly string[]): number => {
    for (let at = 0; at < tokens.length; at += 1) {
        const span = globalSpan(tokens, at)
        if (span > 0) {
            at += span - 1
            continue
        }
        const token = tokens[at] ?? ""
        if (!token.startsWith("-")) return at
        if (!token.includes("=")) at += 1
    }
    return -1
}

const spelled = (tokens: readonly string[]): string => tokens.join(" ")

/** The one line a retired spelling answers: the notice while it maps, the refusal once refusal is on or when nothing replaces it. */
const retiredLine = (old: string, now: string | null): string =>
    now === null ? `"${old}" is retired` : `"${old}" is retired; it runs as "${now}" for now`

/**
 * Rewrites the retired spellings of a command line (the tokens after `starci`, before any `--`) into their new spelling, one
 * notice per rewrite; with `refuse` (REFUSE_RETIRED_SPELLINGS) the first one is refused instead, with its row's code and
 * recovery line. A removed verb is refused whatever `refuse` says.
 */
export const rewriteRetired = (argv: readonly string[], refuse: boolean = REFUSE_RETIRED_SPELLINGS): Rewritten => {
    const dashes = argv.indexOf("--")
    const ours = dashes >= 0 ? argv.slice(0, dashes) : [...argv]
    const theirs = dashes >= 0 ? argv.slice(dashes) : []
    const notices: string[] = []
    const fail = (code: string, old: string, recovery: string): never => {
        throw new Refusal(code, `${retiredLine(old, null)}: ${recovery}`, EXIT_USAGE)
    }
    let tokens = ours
    const [first, second] = pathIndexes(tokens)
    const path = [first, second].flatMap((at) => (at === undefined ? [] : [tokens[at] ?? ""]))
    const verbRow = RETIRED_VERBS.find((row) => row.old[0] === path[0] && row.old[1] === path[1])
    if (verbRow !== undefined && first !== undefined && second !== undefined) {
        const old = spelled(verbRow.old)
        if (verbRow.now === null || refuse) fail(verbRow.code, old, verbRow.recovery)
        const now = verbRow.now ?? []
        let rest = tokens.slice(second + 1)
        for (const flag of verbRow.flags ?? []) rest = renameFlag(rest, flag).tokens
        if (verbRow.operand !== undefined) {
            const at = firstOperand(rest)
            if (at >= 0) rest = [...rest.slice(0, at), verbRow.operand, rest[at] ?? "", ...rest.slice(at + 1)]
        }
        tokens = [...tokens.slice(0, first), ...tokens.slice(first + 1, second), ...now, ...(verbRow.adds ?? []), ...rest]
        notices.push(`starci: ${retiredLine(old, spelled([...now, ...(verbRow.adds ?? [])]))}`)
    }
    const [newFirst, newSecond] = pathIndexes(tokens)
    const verb = [newFirst, newSecond].flatMap((at) => (at === undefined ? [] : [tokens[at] ?? ""])).join(" ")
    const after = newSecond ?? newFirst
    for (const row of RETIRED_FLAGS.filter((candidate) => candidate.verb === verb && after !== undefined)) {
        const head = tokens.slice(0, (after ?? 0) + 1)
        const renamed = renameFlag(tokens.slice((after ?? 0) + 1), row)
        if (!renamed.hit) continue
        const old = `${verb} ${row.old}`
        if (refuse) fail(row.code, old, row.recovery)
        tokens = [...head, ...renamed.tokens]
        notices.push(`starci: ${retiredLine(old, row.now === null ? verb : `${verb} ${row.now}`)}`)
    }
    return { argv: [...tokens, ...theirs], notices }
}

/** The retired spellings that now name a verb (its old paths and flags), for its help and `starci explain`. */
export const retiredOf = (verb: string): readonly string[] => [
    ...RETIRED_VERBS.filter((row) => row.now !== null && spelled(row.now.slice(0, 2)) === verb).map((row) => `${spelled(row.old)} -> ${spelled([...(row.now ?? []), ...(row.adds ?? [])])}`),
    ...RETIRED_FLAGS.filter((row) => row.verb === verb).map((row) => `${row.old} -> ${row.now ?? "(dry by default)"}`),
]
