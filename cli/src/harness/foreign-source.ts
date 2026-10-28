import type { DatabaseSync } from "node:sqlite"
import { Refusal } from "../shared/errors.js"
import type { PlanNode } from "./graph.js"

/** The refusal of a contract that takes another workflow's code as its source instead of routing the need. */
export const NEEDS_REQUIRED = "NEEDS_REQUIRED"

const escape = (text: string): string => text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Every text of a contract's input a worker reads as its instructions: summary, details, and each named input. */
const inputTexts = (node: PlanNode): string[] => {
    const { input } = node.contract
    return [input.summary, input.details ?? "", ...Object.values(input.base ?? {}), ...Object.values(input.extend ?? {})]
}

/** The other workflows of the ledger and the commits their tasks (and every task outside a workflow) landed. */
const foreignSources = (db: DatabaseSync, workflowId: string): { readonly branches: readonly { readonly workflow: string; readonly pattern: RegExp }[]; readonly commits: readonly { readonly owner: string; readonly sha: string }[] } => {
    const branches = db
        .prepare("SELECT id FROM workflows WHERE id != ?")
        .all(workflowId)
        .map((row) => String(row.id))
        .map((workflow) => ({ workflow, pattern: new RegExp(`(?:^|[^\\w./-])(?:refs/heads/|origin/)?starci/${escape(workflow)}(?![\\w-])`) }))
    const commits = db
        .prepare("SELECT settle_commit, workflow_id, id FROM tasks WHERE settle_commit IS NOT NULL AND (workflow_id IS NULL OR workflow_id != ?)")
        .all(workflowId)
        .map((row) => ({ owner: row.workflow_id === null ? `task ${String(row.id)}` : `workflow ${String(row.workflow_id)}`, sha: String(row.settle_commit).toLowerCase() }))
    return { branches, commits }
}

/**
 * Refuses NEEDS_REQUIRED when a task of a workflow's graph names another workflow's branch (`starci/<workflow>`, its Op branches
 * included) or a commit another workflow's task landed as part of its input: a workflow never copies another's landed code, it
 * reports the shared thing missing and the need's one owner builds it once (cli/README.md "Shared needs"). `checked` names the
 * contract hashes judged already (a contract of the current graph), which are not judged again. A ledger that does not exist
 * yet holds no other workflow.
 */
export const assertOwnSources = (db: DatabaseSync | undefined, workflowId: string, nodes: readonly PlanNode[], checked: ReadonlySet<string> = new Set<string>()): void => {
    if (db === undefined) return
    const { branches, commits } = foreignSources(db, workflowId)
    if (branches.length === 0 && commits.length === 0) return
    const problems = nodes
        .filter((node) => !checked.has(node.contractHash))
        .flatMap((node) => {
            const text = inputTexts(node).join("\n")
            const named = [
                ...branches.filter((branch) => branch.pattern.test(text)).map((branch) => `the branch of workflow ${branch.workflow}`),
                ...[...new Set(text.toLowerCase().match(/\b[0-9a-f]{7,40}\b/g) ?? [])].flatMap((token) => commits.filter((commit) => commit.sha.startsWith(token)).map((commit) => `commit ${token} of ${commit.owner}`)),
            ]
            return named.length === 0 ? [] : [`task ${node.key} takes ${[...new Set(named)].join(", ")} as a source`]
        })
    if (problems.length === 0) return
    throw new Refusal(
        NEEDS_REQUIRED,
        `${problems.join("\n")}\nA workflow never copies another workflow's landed code. Plan the task against what this workflow's branch holds; when the shared thing is missing there, its Op reports it (task result --status blocked --needs <key>), the need's one owner builds it once and its commits are relayed onto this branch (cli/README.md "Shared needs"). A need only another workflow can answer is a shared-need decision or an escalation to the Supervisor.`,
    )
}
