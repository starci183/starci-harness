import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { projectFrom } from "../supervisor/driver.js"
import { parkProject } from "./park-engine.js"

/**
 * `starci project park [--project <checkout>] [--execute]`: frees a project of every agent so it spends nothing, resumable later
 * (core/project/park-engine.ts `parkProject`): its workflows paused, each live seat stopped with its task's work kept as one patch
 * and its key back at the same try, each Kernel terminal closed (worktree and graph untouched), its Supervisor stopped, no Orca
 * terminal of it left, and a `project-parked` host event naming what was closed. Nothing relaunches any of it until
 * `project unpark`. Orca itself keeps running for other projects.
 */
export const projectParkVerb = defineVerb({
    path: ["project", "park"],
    summary: "pause every workflow of a project, stop its live seats keeping their work, close its Kernels, Supervisor and every Orca terminal of it; resumable with project unpark (dry until --execute)",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["owner"],
    schema: "starci/project-park@1",
    flags: {
        project: { kind: "string", summary: "any checkout or worktree of the project's repositories (default: the working directory)" },
        execute: { kind: "boolean", summary: "park for real (default: a dry run that says what would be paused, stopped and closed, and changes nothing)" },
    },
    run: async (context, flags) => {
        const project = await projectFrom(context, flags.project)
        const data = await parkProject(context, project, !flags.execute)
        const verb = data.dryRun ? "would park" : "parked"
        const lines = [
            `${verb} project ${data.name}: ${String(data.workflows.length)} workflow(s), ${String(data.tasks.length)} seated task(s), Supervisor ${data.supervisor}`,
            ...data.workflows.map((one) => `workflow ${one.workflow} (was ${one.was}): Kernel ${one.kernel}`),
            ...data.tasks.map((one) => `task ${one.task}${one.worker === null ? "" : ` (worker ${one.worker})`} ${one.action}: ${one.detail}`),
            ...data.terminals.map((one) => `terminal ${one.handle} "${one.title ?? ""}" ${one.outcome}: ${one.why}`),
            ...data.problems,
            data.dryRun ? "nothing changed" : data.left.length === 0 ? "no Orca terminal of the project is left" : `still listed: ${data.left.map((one) => `${one.handle} "${one.title ?? ""}"`).join(", ")}`,
        ]
        return { data, message: lines.join("\n"), exitCode: !data.dryRun && data.left.length > 0 ? 1 : 0 }
    },
})
