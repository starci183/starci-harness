import { resolve } from "node:path"
import { workflowBudgets } from "../../harness/budget.js"
import { buildGraph, planPlace, readPlanSource, uatWalksOf } from "../../harness/graph.js"
import { openLedger } from "../../harness/ledger.js"
import { loadOps } from "../../harness/ops.js"
import { assertRunPlace } from "../../harness/work.js"
import { insertWorkflow } from "../../harness/workflow.js"
import { Refusal } from "../../shared/errors.js"
import { formatTable } from "../../shared/output.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

/**
 * `starci workflow define <file>`: records the Kernel's workflow file as graph version 1. Every contract must be fit, every
 * dependency known and the edges acyclic; the harness never invents a task, it only records the graph it is given.
 */
export const workflowDefineVerb = defineVerb({
    path: ["workflow", "define"],
    summary: "record a workflow file (starci/workflow@1: goal, runner, tasks as contracts with dependsOn) as graph v1; refuses an unfit contract or a cycle",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: ["owner", "kernel", "supervisor"],
    schema: "starci/workflow-define@1",
    flags: {
        file: { kind: "string", summary: "the workflow file, yaml or json", required: true, positional: true },
    },
    run: async (context, flags) => {
        const file = resolve(context.cwd, flags.file)
        const ops = loadOps()
        const place = await planPlace(context.cwd)
        const source = readPlanSource(file, ops, place)
        if (source.kind !== "workflow") throw new Refusal("WORKFLOW_INVALID", `${file} is a change file; define takes a starci/workflow@1 file (a change goes to workflow amend)`)
        const built = buildGraph(source.tasks, ops)
        const problems = [...source.problems, ...built.problems]
        if (problems.length > 0) {
            const listed = problems.map((problem) => `- ${problem}`).join("\n")
            throw new Refusal("WORKFLOW_INVALID", `${file} is not fit:\n${listed}`)
        }
        const root = place.repo
        await Promise.all(uatWalksOf(source, ops).map((walk) => assertRunPlace(root, walk)))
        const db = openLedger(root)
        const workflow = (() => {
            try {
                return insertWorkflow(db, source.header, built.nodes, file)
            } finally {
                db.close()
            }
        })()
        // The row is the workflow's budget account: the ops default ceiling until the owner or the Supervisor raises it.
        const budget = workflowBudgets(root, workflow.id).budgets[0] ?? null
        const nodes = built.nodes.map((node) => ({ key: node.key, label: node.contract.label, dependsOn: node.dependsOn, contractHash: node.contractHash, hash: node.hash }))
        const table = formatTable([["TASK", "LABEL", "DEPENDS ON", "NODE HASH"], ...nodes.map((node) => [node.key, node.label, node.dependsOn.join(", ") || "-", node.hash.slice(0, 12)])])
        const message = [
            `defined workflow ${workflow.id} (${workflow.header.runner}): ${String(nodes.length)} task(s), graph v1`,
            table,
            ...built.notes.map((note) => `note: ${note}`),
            ...(budget === null ? [] : [`budget: ${String(budget.ceiling.minutes)} minutes, ${String(budget.ceiling.tries)} tries`]),
            `start it: starci workflow start ${workflow.id}`,
        ].join("\n")
        return { data: { workflow: workflow.id, runner: workflow.header.runner, status: workflow.status, graphVersion: workflow.graphVersion, goal: workflow.header.goal, budget, nodes, notes: built.notes }, message }
    },
})
