import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"
import { z } from "zod"
import { runtimeRoot } from "../../harness/ledger.js"
import { Refusal } from "../../shared/errors.js"

/** The groups of the catalog, in scoreboard order. */
export const GROUPS = [
    "acceptance",
    "lifecycle",
    "crash",
    "orca",
    "provider",
    "change",
    "conflict",
    "worker",
    "git",
    "budget",
    "verify",
    "messaging",
    "scale",
    "security",
    "time",
    "resources",
    "upgrade",
    "ledger",
    "model",
    "plan",
    "environment",
    "owner",
    "release",
    "cost",
] as const

/** How a scenario runs: by `bench run` alone, only with a live Orca beside it, or by hand. */
export const AUTOMATION = ["automated", "semi", "manual"] as const

const envelopeExpect = z.strictObject({
    exit: z.number().int().optional(),
    ok: z.boolean().optional(),
    code: z.string().optional(),
    /** Substring the human or json output must contain. */
    contains: z.string().optional(),
    /** Substring neither stdout nor stderr may contain (a secret's value); the failure never prints the output. */
    lacks: z.string().optional(),
})

/** `repo` names the repository of the run (one of `repos`) whose ledger a `ledger` query reads; default the scratch repository. */
const sqlAssert = z.strictObject({
    db: z.enum(["ledger", "machine"]),
    repo: z.string().optional(),
    query: z.string(),
    equals: z.unknown(),
})

const assertSchema = z.strictObject({
    sql: sqlAssert.optional(),
    /** `in` names another repository (a bare remote) relative to the scratch repository; default the scratch repository. `ref` is the history read, default HEAD. */
    gitLog: z.strictObject({ grep: z.string(), count: z.number().int(), in: z.string().optional(), ref: z.string().optional() }).optional(),
    gitClean: z.boolean().optional(),
    gitHas: z.strictObject({ path: z.string(), present: z.boolean(), in: z.string().optional() }).optional(),
    /** `match` keeps only the calls whose named flags each match a regular expression (`task-title: "^\[Op\]"`). */
    orcaCalls: z
        .strictObject({ command: z.string(), match: z.record(z.string(), z.string()).optional(), count: z.number().int().optional(), min: z.number().int().optional(), max: z.number().int().optional(), distinct: z.string().optional() })
        .optional(),
    exists: z.strictObject({ path: z.string(), present: z.boolean() }).optional(),
})

/** Fixtures a step may write that must never sit in this public repository as text: they are built at run time. */
export const GENERATED = ["secret", "loosening", "font-page", "font-page-secret"] as const

const stepSchema = z.strictObject({
    name: z.string().optional(),
    /** The step runs only under this fault (`bench run --fault <name>`). */
    when: z.string().optional(),
    /** The step is skipped under this fault. */
    unless: z.string().optional(),
    starci: z.array(z.string()).optional(),
    /**
     * Who runs the verb: `supervisor` (the booted Supervisor of the scratch repository's project, its terminal and role),
     * `supervisor:<repo>` (the Supervisor of the project of another repository of the run, from that repository) or
     * `kernel:<workflow>` (that workflow's Kernel terminal and role, from its worktree unless `cwd` says otherwise). Unset, the
     * owner runs it outside Orca.
     */
    seat: z.string().regex(/^(?:supervisor(?::[\w.-]+)?|kernel:[\w.-]+)$/).optional(),
    /**
     * Boots the coordinator tree through real verbs on the stand-in: the Supervisor of `project` (a repository of the run, default
     * the scratch repository: `supervisor start` and `supervisor attach` from it, once per project), `workflow define <file>` in
     * the repository `in` (default the project's) when a file is named, `workflow start <workflow>` there from that Supervisor's
     * terminal and `kernel attach` from the Kernel terminal it launched (unless `attach` is false); `adopt` attaches a workflow's
     * current Kernel seat (one `supervisor next` relaunched). It saves supervisor.{launch,terminal,run} (supervisor.<project>.*
     * for another repository's project), kernel.<workflow>.{launch,terminal,run} and worktree.<workflow>.
     */
    boot: z
        .strictObject({ project: z.string().optional(), in: z.string().optional(), file: z.string().optional(), workflow: z.string().optional(), attach: z.boolean().optional(), adopt: z.string().optional() })
        .optional(),
    /** Saves the first value of a query's first row under a variable name. */
    read: z.strictObject({ db: z.enum(["ledger", "machine"]), repo: z.string().optional(), query: z.string(), as: z.string() }).optional(),
    /** Runs the verb this many times at once (contention); each copy is held to `expect`. */
    parallel: z.number().int().min(2).max(64).optional(),
    /** Where the verb runs; default the scratch repository. */
    cwd: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    expect: envelopeExpect.optional(),
    /** Saves `data.<path>` of a verb's json envelope, or `stdout` of a git step (trimmed), under a variable name. */
    save: z.record(z.string(), z.string()).optional(),
    /** Writes `content` (or a `generated` fixture) to a path of the scratch repository, or copies the file or folder `from` there (`${ops}` is the ops/ folder the CLI reads). */
    write: z.strictObject({ path: z.string(), content: z.string().optional(), generated: z.enum(GENERATED).optional(), crlf: z.boolean().optional(), from: z.string().optional() }).optional(),
    remove: z.string().optional(),
    file: z.strictObject({ path: z.string(), content: z.string().optional(), yaml: z.unknown().optional(), crlf: z.boolean().optional() }).optional(),
    worker: z
        .strictObject({
            task: z.string(),
            status: z.enum(["done", "blocked", "mismatch", "failed"]).default("done"),
            files: z.record(z.string(), z.string()).optional(),
            remove: z.array(z.string()).optional(),
            output: z.unknown().optional(),
        })
        .optional(),
    git: z.array(z.string()).optional(),
    /**
     * Scripts the stand-in: fault rules, raw state, a worker state (`dispatch` `*` names every Op dispatch so far, `kernel` every
     * Kernel dispatch), and mail put into a mailbox as if a seat had sent it (`to` is `run:<id>` or `dispatch:<id>`).
     */
    orca: z
        .strictObject({
            rules: z.array(z.record(z.string(), z.unknown())).optional(),
            set: z.record(z.string(), z.unknown()).optional(),
            worker: z.strictObject({ dispatch: z.string(), state: z.string() }).optional(),
            mail: z.array(z.strictObject({ to: z.string(), type: z.string(), from: z.string().optional(), subject: z.string().optional(), body: z.string().optional(), payload: z.unknown().optional(), count: z.number().int().min(1).max(500).optional() })).optional(),
            /** A terminal's presence, and optionally the title and orphaned flag `terminal list` shows for it. */
            terminal: z.strictObject({ handle: z.string(), live: z.boolean(), title: z.string().optional(), orphaned: z.boolean().optional() }).optional(),
        })
        .optional(),
    sql: z.strictObject({ db: z.enum(["ledger", "machine"]), repo: z.string().optional(), exec: z.string() }).optional(),
    /**
     * Starts a long-lived verb (`starci ui --port 0`) or a bench stand-in (`stub: telegram`, bench/stub/telegram-stub.mjs) in the
     * scratch repository until the scenario ends, and saves the URL and token its ready line prints (`starci ui: <url> token
     * <token>`, `stub telegram: <url> token <token>`) as `<as>.url` and `<as>.token`.
     */
    serve: z
        .strictObject({ starci: z.array(z.string()).min(1).optional(), stub: z.enum(["telegram"]).optional(), as: z.string().regex(/^[\w-]+$/) })
        .refine((serve) => (serve.starci === undefined) !== (serve.stub === undefined), "serve names exactly one of starci and stub")
        .optional(),
    /**
     * One HTTP request to a served verb: `token` is sent as `Authorization: Bearer`; `stream` reads an event stream only until
     * `contains` shows. `has` lists dotted paths of the JSON answer that must exist, `equals` a value per path; `save` keeps one.
     */
    http: z
        .strictObject({
            method: z.enum(["GET", "POST"]).default("GET"),
            url: z.string(),
            token: z.string().optional(),
            body: z.unknown().optional(),
            stream: z.boolean().optional(),
            expect: z.strictObject({ status: z.number().int().optional(), contains: z.string().optional(), has: z.array(z.string()).optional(), equals: z.record(z.string(), z.unknown()).optional() }).optional(),
            save: z.record(z.string(), z.string()).optional(),
        })
        .optional(),
    assert: assertSchema.optional(),
})

/** One step of an automated scenario: a verb, a write, a worker's filing, a git command, a fault or an assertion. */
export type Step = z.infer<typeof stepSchema>

/** A step's assertion. */
export type Assertion = z.infer<typeof assertSchema>

const scenarioSchema = z.strictObject({
    schema: z.literal("starci/scenario@1"),
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    group: z.enum(GROUPS),
    title: z.string(),
    inject: z.string(),
    expect: z.string(),
    pass: z.array(z.string()).min(1),
    automation: z.enum(AUTOMATION),
    /** Why it is not automated today: the verbs or harness pieces it waits for (empty when it runs). */
    pending: z.string().optional(),
    /** A harness defect this scenario exposes, with the file:line that owns it; the scenario stays red until the harness changes. */
    finding: z.string().optional(),
    /** The exact steps a person or a later automation follows while it is pending. */
    manual: z.array(z.string()).optional(),
    faults: z.array(z.string()).optional(),
    repo: z.strictObject({ dir: z.string().optional(), files: z.record(z.string(), z.string()).optional() }).optional(),
    /** More repositories beside the scratch one, each `<run>/<name>` (`${repo.<name>}`), for scenarios of several projects or sides. */
    repos: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), z.strictObject({ files: z.record(z.string(), z.string()).optional() })).optional(),
    env: z.record(z.string(), z.string()).optional(),
    steps: z.array(stepSchema).optional(),
})

/** One stress scenario as `bench/scenarios/<id>.yaml` declares it (`starci/scenario@1`). */
export type Scenario = z.infer<typeof scenarioSchema>

/** The bench folder of this harness checkout: the scoreboard and the scenarios. */
export const benchRoot = (): string => join(runtimeRoot(), "bench")

/** True when the scenario carries steps the runner executes; anything else is pending on the scoreboard. */
export const runnable = (scenario: Scenario): boolean => scenario.automation === "automated" && scenario.pending === undefined && (scenario.steps?.length ?? 0) > 0

/** Reads and validates every scenario file, sorted by group then id; refuses the first file that is not fit. */
export const loadScenarios = (): Scenario[] => {
    const dir = join(benchRoot(), "scenarios")
    if (!existsSync(dir)) throw new Refusal("BENCH_MISSING", `${dir} does not exist`)
    const scenarios = readdirSync(dir)
        .filter((name) => name.endsWith(".yaml"))
        .map((name) => {
            const parsed = scenarioSchema.safeParse(parse(readFileSync(join(dir, name), "utf8")))
            if (!parsed.success) throw new Refusal("SCENARIO_INVALID", `${name}: ${z.prettifyError(parsed.error)}`)
            if (`${parsed.data.id}.yaml` !== name) throw new Refusal("SCENARIO_INVALID", `${name} declares id ${parsed.data.id}`)
            return parsed.data
        })
    const order = (scenario: Scenario): number => GROUPS.indexOf(scenario.group)
    return scenarios.sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id))
}
