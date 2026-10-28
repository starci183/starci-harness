import { locateOrca } from "../../harness/orca/client.js"
import { requireSupervisor } from "../../harness/supervisor.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { projectFrom } from "./driver.js"
import { dispatchWorker } from "./workers.js"

/** Every value of a repeatable list flag, each also split on commas. */
const listOf = (values: readonly string[]): string[] =>
    values
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter((value) => value !== "")

/**
 * `starci supervisor dispatch --brief <file|text>`: the Supervisor never works hands-on; it hands each job (a code or package fix,
 * an investigation) to a `[Worker] <project>: <topic>` seat under it, launched through Orca in its own worktree with a rendered
 * brief and routed by the label's worker tier (`dispatchWorker` in core/supervisor/workers.ts). Past the project's worker cap it
 * waits queued; `supervisor next` launches it once a seat is released and returns its report.
 */
export const supervisorDispatchVerb = defineVerb({
    path: ["supervisor", "dispatch"],
    summary: "hand one job to a [Worker] seat under the project's Supervisor: its own worktree of --repo, a task whose contract is the brief on the label's op, launched by the router (queued past projectMaxWorkers)",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["supervisor"],
    schema: "starci/supervisor-dispatch@1",
    flags: {
        brief: { kind: "string", required: true, summary: "the job: a file whose text is the brief, or the brief's text itself" },
        label: { kind: "string", summary: "the worker label the router and the checks go by (an op of ops/ops/; default code)" },
        repo: { kind: "string", summary: "the checkout the worker branches from and writes (default: the project's Work-root repository); a @starci package fix keeps the default and names the package with --input package=<name>" },
        allow: { kind: "list", summary: "a path the worker may write (repeat or comma-separate); default its one report file starci-worker-<id>.md" },
        input: { kind: "list", summary: "an input of the label's op as name=value (code: side=be|fe|harness, edition=lite|full|harness)" },
        topic: { kind: "string", summary: "the topic in the worker's title (default the brief's first line)" },
        project: { kind: "string", summary: "any checkout or worktree of the project's repositories (default: the working directory)" },
    },
    run: async (context, flags) => {
        const project = await projectFrom(context, flags.project)
        const seat = await requireSupervisor(await locateOrca(context.cwd), context.cwd, project)
        const data = await dispatchWorker(context, seat, project, { brief: flags.brief, label: flags.label ?? "code", repo: flags.repo, allow: listOf(flags.allow), inputs: flags.input, topic: flags.topic })
        return { data, message: [`worker ${data.worker} "${data.title}": task ${data.task} in ${data.repo}, worktree ${data.worktree} on ${data.branch}`, data.detail].join("\n") }
    },
})
