import { resolve } from "node:path"
import { workflowBudgets } from "../../harness/budget.js"
import type { WorkflowBudget } from "../../harness/budget.js"
import { assertOwnSources } from "../../harness/foreign-source.js"
import { assertScope } from "../../harness/goal.js"
import { buildGraph, planPlace, readPlanSource, uatWalksOf } from "../../harness/graph.js"
import { assertFlow, flowLines } from "../../harness/lanes.js"
import { openExistingLedger, openLedger } from "../../harness/ledger.js"
import { loadOps } from "../../harness/ops.js"
import { assertRunPlace } from "../../harness/work.js"
import { insertWorkflow } from "../../harness/workflow.js"
import type { WorkflowStatus } from "../../harness/workflow.js"
import { Refusal } from "../../shared/errors.js"
import { formatTable } from "../../shared/output.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

/** What a define reports; a `--check` run has status `checked`, graph version 0 and no budget, since nothing was recorded. */
interface DefineReport {
    readonly workflow: string
    readonly runner: string
    readonly status: WorkflowStatus | "checked"
    readonly graphVersion: number
    readonly goal: string
    readonly budget: WorkflowBudget | null
    readonly nodes: readonly { readonly key: string; readonly label: string; readonly dependsOn: readonly string[]; readonly contractHash: string; readonly hash: string }[]
    readonly notes: readonly string[]
    readonly lanes: readonly string[]
}

/**
 * `starci workflow define <file>`: records the Kernel's workflow file as graph version 1. Every contract must be fit, every
 * dependency known and the edges acyclic; the harness never invents a task, it only records the graph it is given. The file's
 * goal (text, acceptance, scope ceiling) is recorded as goal v1, and the graph must fit that ceiling (SCOPE_EXCEEDED) and walk
 * the lane of every Work record it covers (FLOW_INCOMPLETE, harness/lanes.ts); a task whose input takes another workflow's branch or
 * landed commit as its source is refused NEEDS_REQUIRED (harness/foreign-source.ts). `--check` runs every one of those checks and
 * records nothing, so a workflow file can be proven before its project's ledger takes it.
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
        check: { kind: "boolean", summary: "run every define check and record nothing" },
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
        // Goal v1 is the file's goal; a scope ceiling it carries holds from the first graph on.
        assertScope(source.header.id, built.nodes, { version: 1, scope: source.header.scope ?? null })
        const root = place.repo
        const known = openExistingLedger(root)
        const lanes = (() => {
            try {
                assertOwnSources(known, source.header.id, built.nodes)
                return flowLines(assertFlow(source.header.id, built.nodes, { repo: root, db: known, requires: source.header.requires ?? [] }, ops))
            } finally {
                known?.close()
            }
        })()
        await Promise.all(uatWalksOf(source, ops).map((walk) => assertRunPlace(root, walk)))
        const nodes = built.nodes.map((node) => ({ key: node.key, label: node.contract.label, dependsOn: node.dependsOn, contractHash: node.contractHash, hash: node.hash }))
        if (flags.check) {
            const message = [`${file} is fit: workflow ${source.header.id}, ${String(nodes.length)} task(s); nothing recorded`, ...built.notes.map((note) => `note: ${note}`), ...lanes.map((line) => `lane: ${line}`)].join("\n")
            const checked: DefineReport = { workflow: source.header.id, runner: source.header.runner, status: "checked", graphVersion: 0, goal: source.header.goal, budget: null, nodes, notes: built.notes, lanes }
            return { data: checked, message }
        }
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
        const table = formatTable([["TASK", "LABEL", "DEPENDS ON", "NODE HASH"], ...nodes.map((node) => [node.key, node.label, node.dependsOn.join(", ") || "-", node.hash.slice(0, 12)])])
        const message = [
            `defined workflow ${workflow.id} (${workflow.header.runner}): ${String(nodes.length)} task(s), graph v1`,
            table,
            ...built.notes.map((note) => `note: ${note}`),
            ...lanes.map((line) => `lane: ${line}`),
            ...(budget === null ? [] : [`budget: ${String(budget.ceiling.minutes)} minutes, ${String(budget.ceiling.tries)} tries`]),
            `start it: starci workflow start ${workflow.id}`,
        ].join("\n")
        const recorded: DefineReport = { workflow: workflow.id, runner: workflow.header.runner, status: workflow.status, graphVersion: workflow.graphVersion, goal: workflow.header.goal, budget, nodes, notes: built.notes, lanes }
        return { data: recorded, message }
    },
})
