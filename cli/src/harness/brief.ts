import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Refusal } from "../shared/errors.js"
import { ROLE_ENV } from "../shared/role.js"
import type { Role } from "../shared/verb.js"
import { resolveChecks } from "./contract.js"
import { projectDir } from "./ledger.js"
import type { Ops, PrimitiveCheck } from "./ops.js"
import type { TaskRow } from "./tasks.js"

/** The files one worker brief is made of, all in the project's state folder outside the repository (see briefsDir). */
export interface BriefFiles {
    readonly brief: string
    readonly contract: string
    readonly output: string
}

/**
 * Where the brief and the contract copy the worker verifies against live: briefs/ of the project's state folder under the state
 * base, shared by every linked worktree and never inside a product repository. The worker's output file sits in outputs/ beside it.
 */
export const briefsDir = (root: string): string => join(projectDir(root), "briefs")

/** The brief files of one task (see briefsDir). */
export const briefFiles = (root: string, taskId: string): BriefFiles => {
    const dir = briefsDir(root)
    return { brief: join(dir, `${taskId}.md`), contract: join(dir, `${taskId}.contract.json`), output: join(dirname(dir), "outputs", `${taskId}.json`) }
}

// Paths go into the brief with forward slashes, so a command copied from it runs the same in every shell.
const slashed = (path: string): string => path.replace(/\\/g, "/")

/** What one primitive check runs, in words a worker can act on. */
const describeCheck = (check: PrimitiveCheck): string => {
    switch (check.kind) {
        case "starci":
            return `\`starci ${check.args.join(" ")}\` exits 0`
        case "command":
            return `\`${Array.isArray(check.run) ? check.run.join(" ") : check.run}\` exits 0`
        case "files": {
            const parts = [
                ...(check.onlyAllowPaths === true ? ["nothing outside allowPaths changed since the base"] : []),
                ...(check.mustExist === undefined || check.mustExist.length === 0 ? [] : [`these exist: ${check.mustExist.join(", ")}`]),
            ]
            return parts.length === 0 ? "files as expected" : parts.join("; ")
        }
        case "json":
            return `${check.file} is json carrying the keys ${check.requiredKeys.join(", ")}`
        case "probe":
            return `${check.url} answers ${String(check.status)}`
    }
}

const bullets = (items: readonly string[], none: string): string => (items.length === 0 ? `- ${none}` : items.map((item) => `- ${item}`).join("\n"))

/** The worker template of ops/worker.md with the task's ids and files filled in; every placeholder must be known. */
const renderTemplate = (ops: Ops, values: Readonly<Record<string, string>>): string => {
    const file = join(ops.dir, "worker.md")
    let template: string
    try {
        template = readFileSync(file, "utf8")
    } catch {
        throw new Refusal("OPS_INVALID", `the worker brief ${file} is missing`)
    }
    const filled = template.replace(/\{([A-Za-z]+)\}/g, (match: string, key: string) => values[key] ?? match)
    const unknown = [...filled.matchAll(/\{([A-Za-z]+)\}/g)].map((found) => found[0])
    if (unknown.length > 0) throw new Refusal("OPS_INVALID", `${file} names placeholders the harness does not fill: ${[...new Set(unknown)].join(", ")}`)
    return filled.trimEnd()
}

/** Renders the brief a worker reads: ops/worker.md, then the task's own contract in plain words; `role` is who works it (an Orca worker, or the inline chat agent). */
export const renderBrief = (task: TaskRow, ops: Ops, root: string, files: BriefFiles, role: Role = "worker"): string => {
    const { contract } = task
    const label = ops.labels[contract.label]
    const checks = resolveChecks(contract, ops)
    const cli = slashed(fileURLToPath(new URL("../main.js", import.meta.url)))
    const template = renderTemplate(ops, { taskId: task.id, contractFile: slashed(files.contract), outputFile: slashed(files.output) })
    const sections = [
        template,
        `## Task ${task.id}`,
        [
            `Label: ${contract.label}${label === undefined ? "" : ` (${label.summary})`}`,
            `Try: ${String(task.tryNo)} of ${String(contract.budget.tries)}`,
            `Repository: ${slashed(root)}`,
            `Base: ${contract.context.base}`,
            `Working folder: ${contract.context.cwd ?? "the repository root"}`,
            `CLI: \`starci\`; when it is not on PATH, run \`node ${cli}\` in its place`,
            // Orca's worker-start has no flag to set the worker's environment, so the role travels in the brief.
            `Role: ${role}. Run every starci command with ${ROLE_ENV}=${role} in its environment (sh: \`${ROLE_ENV}=${role} starci ...\`; PowerShell: \`$env:${ROLE_ENV}='${role}'\`); a verb your role may not run refuses ROLE_REFUSED`,
        ]
            .map((fact) => `- ${fact}`)
            .join("\n"),
        "### Input",
        [contract.input.summary, contract.input.details].filter((part) => part !== undefined && part !== "").join("\n\n"),
        "### Write only under",
        bullets(contract.context.allowPaths, "nothing"),
        "### Read",
        bullets(contract.context.readPaths ?? [], "what the input and allowPaths need; nothing else is named"),
        "### Checks your result must pass",
        bullets(
            checks.map((check) => `${check.name}: ${describeCheck(check.check)}${check.behavioural ? " (behaviour)" : ""}`),
            "none",
        ),
        "### Budget",
        `${String(contract.budget.minutes)} minutes, ${String(contract.budget.tries)} tries in all.`,
    ]
    return `${sections.join("\n\n")}\n`
}

/**
 * The short spec Orca hands the agent: a pointer to the brief file. The brief itself never travels in argv, which Windows caps
 * (legacy allocation.promptFile: a terminal prompt above 2000 characters goes to a file).
 */
export const pointerSpec = (taskId: string, files: BriefFiles): string =>
    [
        `[Op] StarCi task ${taskId}. Your brief is too long for a terminal, so the harness wrote it to a file:`,
        `  ${slashed(files.brief)}`,
        "Read that whole file now, to the end, before any other action. It is your task: the rules, the contract, the paths,",
        "the checks, the budget and the commands that return your result. Nothing in this message narrows it; never write to that file.",
    ].join("\n")

/** Writes a task's brief and the contract copy it points at; returns the files. The worker writes the output file itself. */
export const writeBrief = (task: TaskRow, ops: Ops, root: string, role: Role = "worker"): BriefFiles => {
    const files = briefFiles(root, task.id)
    const brief = renderBrief(task, ops, root, files, role)
    mkdirSync(dirname(files.brief), { recursive: true })
    mkdirSync(dirname(files.output), { recursive: true })
    writeFileSync(files.contract, `${JSON.stringify(task.contract, null, 2)}\n`)
    writeFileSync(files.brief, brief)
    return files
}
