import { locateOrca } from "../../harness/orca/client.js"
import { attachSupervisor } from "../../harness/supervisor.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

/** Binds the launched Supervisor's own terminal to its host record and Orca Run. */
export const supervisorAttachVerb = defineVerb({
    path: ["supervisor", "attach"],
    summary: "attach the reserved Supervisor agent terminal and create its Run and task",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["supervisor"],
    schema: "starci/supervisor@1",
    flags: { launch: { kind: "string", required: true, summary: "the launch id supplied in the generated Supervisor brief" } },
    run: async (context, flags) => {
        const data = await attachSupervisor(await locateOrca(context.cwd), context.cwd, flags.launch)
        return { data, message: `attached [Supervisor] ${data.terminal ?? "-"} to Run ${data.run_id ?? "-"}, task ${data.task_id ?? "-"}` }
    },
})
