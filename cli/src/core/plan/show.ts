import type { NodeView } from "../../harness/graph.js"
import { openExistingLedger } from "../../harness/ledger.js"
import { getWorkflow, graphOf, graphVersions, snapshotOf } from "../../harness/workflow.js"
import { EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { formatTable } from "../../shared/output.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"

/** `starci plan show <workflow> [--version n]`: a graph as recorded: tasks, edges, contract and node hashes, and (current graph) their states. */
export const planShowVerb = defineVerb({
    path: ["plan", "show"],
    summary: "a workflow's graph: tasks, dependencies, contract and node hashes, each task's state and ledger task, and the graph versions",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/plan-show@1",
    flags: {
        workflow: { kind: "string", summary: "the workflow id", required: true, positional: true },
        version: { kind: "string", summary: "an earlier graph version (default: the current one, the only one with states)" },
    },
    run: async (context, flags) => {
        const db = openExistingLedger(await repositoryRoot(context.cwd))
        if (db === undefined) throw new Refusal("WORKFLOW_UNKNOWN", `no workflow ${flags.workflow}: this project has no ledger yet`)
        try {
            const workflow = getWorkflow(db, flags.workflow)
            const version = flags.version === undefined ? workflow.graphVersion : Number(flags.version)
            if (!Number.isInteger(version) || version < 1 || version > workflow.graphVersion) {
                throw new Refusal("CLI_USAGE", `--version must be a graph version of ${workflow.id}, 1 to ${String(workflow.graphVersion)}`, EXIT_USAGE)
            }
            const current = version === workflow.graphVersion
            const views = current ? new Map(snapshotOf(db, workflow.id).views.map((view) => [view.key, view])) : new Map<string, NodeView>()
            const nodes = graphOf(db, workflow.id, version).map((node) => {
                const view = views.get(node.key)
                return {
                    key: node.key,
                    label: node.contract.label,
                    summary: node.contract.input.summary,
                    allowPaths: node.contract.context.allowPaths,
                    dependsOn: node.dependsOn,
                    round: node.round,
                    route: node.route,
                    contractHash: node.contractHash,
                    hash: node.hash,
                    state: view?.state ?? null,
                    task: view?.task?.id ?? null,
                    why: view?.why ?? null,
                }
            })
            const versions = graphVersions(db, workflow.id).map((row) => ({ version: row.version, goalVersion: row.goalVersion, reason: row.reason, createdAt: row.createdAt, classes: row.classification.map((entry) => `${entry.key}:${entry.class}`) }))
            const table = formatTable([
                ["TASK", "LABEL", "DEPENDS ON", "ALLOW", "CONTRACT", "NODE", ...(current ? ["STATE", "LEDGER TASK"] : [])],
                ...nodes.map((node) => [
                    node.key,
                    node.label,
                    node.dependsOn.join(", ") || "-",
                    node.allowPaths.join(", "),
                    node.contractHash.slice(0, 12),
                    node.hash.slice(0, 12),
                    ...(current ? [node.state ?? "-", node.task ?? "-"] : []),
                ]),
            ])
            const history = versions.map((row) => `v${String(row.version)} (goal v${String(row.goalVersion)}, ${row.createdAt}): ${row.reason ?? "-"}${row.classes.length === 0 ? "" : ` [${row.classes.join(" ")}]`}`)
            const message = [`workflow ${workflow.id}, graph v${String(version)}${current ? " (current)" : ` of ${String(workflow.graphVersion)}`}: ${workflow.header.goal}`, table, "versions:", ...history].join("\n")
            return { data: { workflow: workflow.id, graphVersion: version, current, nodes, versions }, message }
        } finally {
            db.close()
        }
    },
})
