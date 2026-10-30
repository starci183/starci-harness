import { EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import type { VerbResult } from "../../shared/verb.js"
import { exitOf, reportMessage, stepWorkflow } from "./engine.js"
import { LOOP_SUMMARIES, loopWorkflow } from "./loop.js"

/**
 * `starci workflow step <id>`: one idempotent dispatch tick: settle what is reported (task verify), dispatch what became ready,
 * move the workflow's status. Exit 1 when the workflow is blocked, so a loop stops and the Kernel amends. `--loop` repeats the
 * same step in the foreground, one line per change (core/workflow/loop.ts).
 */
export const workflowStepVerb = defineVerb({
    path: ["workflow", "step"],
    summary: "one dispatch tick: ping running seats, verify reported tasks, dispatch newly ready ones within maxParallel, update the status (exit 1 when blocked); --loop repeats it in the foreground until done, blocked or idle",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["owner", "kernel", "supervisor", "agent"],
    schema: "starci/workflow-step@1",
    flags: {
        workflow: { kind: "string", summary: "the workflow id", required: true, positional: true },
        loop: { kind: "boolean", summary: "repeat the step in a foreground loop, one line per change, until done, blocked, idle or --max-ticks" },
        interval: { kind: "string", summary: LOOP_SUMMARIES.interval },
        until: { kind: "string", summary: LOOP_SUMMARIES.until },
        "max-ticks": { kind: "string", summary: LOOP_SUMMARIES.maxTicks },
    },
    run: async (context, flags): Promise<VerbResult<unknown>> => {
        if (flags.loop) return loopWorkflow(context, flags.workflow, flags)
        const loose = (["interval", "until", "max-ticks"] as const).filter((name) => flags[name] !== undefined)
        if (loose.length > 0) throw new Refusal("CLI_USAGE", `${loose.map((name) => `--${name}`).join(", ")} shape a loop: add --loop`, EXIT_USAGE)
        const report = await stepWorkflow(context, await repositoryRoot(context.cwd), flags.workflow)
        return { data: report, message: reportMessage(report), exitCode: exitOf(report) }
    },
})
