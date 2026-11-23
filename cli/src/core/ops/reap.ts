import { Refusal } from "../../shared/errors.js"
import { WRITERS, defineVerb } from "../../shared/verb.js"
import { liveReapProbe, reapLines, reapRuns } from "../../harness/runs.js"
import { loadSlotRules, slotRoot } from "../../harness/slots.js"

/**
 * `starci ops reap [--execute]`: the orphan reaper (harness/runs.ts) over the runs the harness recorded in `<slot root>/_runs/`: a run whose
 * launcher is gone past `reap.graceMinutes` of ops/slots.yaml has its process tree stopped and logged in `<slot root>/_reap.log`. A process the
 * harness did not record is never touched. The batch lander runs the same reap every loop.
 */
export const opsReapVerb = defineVerb({
    path: ["ops", "reap"],
    summary: "stop the harness-started runs (slot runs, lane gates, gallery shoots and looks, app checks; recorded in <slot root>/_runs/ with their launchers) whose launcher has been gone longer than reap.graceMinutes of ops/slots.yaml: the run's whole process tree goes and each stop is logged in <slot root>/_reap.log; a process the harness did not record is never touched (dry run until --execute; an --execute also stamps when an orphan was first seen)",
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/ops-reap@1",
    flags: {
        dir: { kind: "string", summary: "the slot root (default: STARCI_LANES_DIR, else slots.root of ops/slots.yaml, else <harness state>/slots)" },
        execute: { kind: "boolean", summary: "stop the orphans past their grace (default: a dry run that says what it would stop)" },
    },
    run: async (_context, flags) => {
        const rules = loadSlotRules()
        const root = slotRoot(flags.dir, rules)
        const probe = await liveReapProbe()
        if (typeof probe === "string") throw new Refusal("OPS_REAP_UNREADABLE", `the process table could not be read (${probe}): nothing was judged`)
        const grace = rules.reap?.graceMinutes ?? 10
        const report = reapRuns(root, probe, grace, flags.execute)
        return { data: { root, graceMinutes: grace, execute: flags.execute, verdicts: report.verdicts.map((verdict) => ({ pid: verdict.record.pid, label: verdict.record.label, cwd: verdict.record.cwd, state: verdict.state, due: verdict.due, evidence: verdict.evidence })), stopped: report.stopped.map((record) => record.pid) }, message: [`slot root ${root}; grace ${String(grace)} min`, ...reapLines(report, flags.execute)].join("\n") }
    },
})
