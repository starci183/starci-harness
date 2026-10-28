import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Refusal } from "../shared/errors.js"
import { ROLE_ENV } from "../shared/role.js"
import type { Role } from "../shared/verb.js"
import { CITES_KEY, GRADES_KEY, citesBriefSection } from "./cite.js"
import { contextPath, resolveChecks, resolveContract } from "./contract.js"
import type { ResolvedOutput } from "./contract.js"
import { projectDir } from "./ledger.js"
import { OP_FILES, OPS_README, workerProcedure } from "./ops.js"
import type { Ops, PrimitiveCheck } from "./ops.js"
import { priorWorkSection } from "./prior.js"
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
const slashed = (path: string): string => path.replaceAll("\\", "/")

const code = (text: string): string => `\`${text}\``

/** A files check in words: nothing changed outside allowPaths, and the files that must exist. */
const describeFilesCheck = (check: PrimitiveCheck & { readonly kind: "files" }): string => {
    const parts = [
        ...(check.onlyAllowPaths === true ? ["nothing outside allowPaths changed since the revision"] : []),
        ...(check.mustExist === undefined || check.mustExist.length === 0 ? [] : [`these exist: ${check.mustExist.join(", ")}`]),
    ]
    return parts.length === 0 ? "files as expected" : parts.join("; ")
}

/** A cite check in words: the author's cites resolve and name each family's Choose anchor; the grader grades each handed cite. */
const describeCiteCheck = (check: PrimitiveCheck & { readonly kind: "cite" }): string =>
    [
        ...(check.author === true ? [`every id under ${code(CITES_KEY)} resolves, and each Grammar family your changed files import has a Choose anchor cited (${code("<family>.choose")})`] : []),
        ...(check.grade === true ? [`each handed cite is graded once under ${code(GRADES_KEY)}, and none is violated`] : []),
    ].join("; ") || "the handed cites resolve"

/** What one primitive check runs, in words a worker can act on. */
const describeCheck = (check: PrimitiveCheck): string => {
    switch (check.kind) {
        case "starci":
            return `${code("starci " + check.args.join(" "))} exits 0`
        case "command": {
            const run = code(Array.isArray(check.run) ? check.run.join(" ") : check.run)
            // A verdict check reruns the suite: green when the result's verdict agrees with its exit, not when it exits 0.
            const judged = check.verdict === undefined ? `${run} exits 0` : `${run} reruns on the clean checkout and your verdict must agree with its exit`
            // With coverage: changed the app's thresholds hold every changed logic file, so a file of yours below them is red.
            return check.coverage === "changed" ? `${judged}, its coverage narrowed to the logic files you changed (each held to the app's thresholds)` : judged
        }
        case "files":
            return describeFilesCheck(check)
        case "json": {
            const keys = check.requiredKeys.map((key) => {
                const type = check.types?.[key]
                return type === undefined ? key : `${key} (${type})`
            })
            return `${check.file} is json carrying the keys ${keys.join(", ")}`
        }
        case "probe":
            return `${check.url} answers ${String(check.status)}`
        case "uat-flow":
            return `your result walks every step of ${check.record}, each check at its expected value, with report.md and a screenshot per step in ${check.run}`
        case "cited": {
            const keys = (check.trace ?? []).map((trace) => trace.key)
            return `every id under ${keys.length === 0 ? "a traced key" : keys.join(", ")} is named by a file you read (a heading token or a yaml ${code("id:")})`
        }
        case "cite":
            return describeCiteCheck(check)
    }
}

const bullets = (items: readonly string[], none: string): string => (items.length === 0 ? `- ${none}` : items.map((item) => `- ${item}`).join("\n"))

/** Fills a brief text's placeholders with the task's ids and files; every placeholder must be known. */
const fillTemplate = (template: string, where: string, values: Readonly<Record<string, string>>): string => {
    const filled = template.replace(/\{([A-Za-z]+)\}/g, (match: string, key: string) => values[key] ?? match)
    const unknown = [...filled.matchAll(/\{([A-Za-z]+)\}/g)].map((found) => found[0])
    if (unknown.length > 0) throw new Refusal("OPS_INVALID", `${where} names placeholders the harness does not fill: ${[...new Set(unknown)].join(", ")}`)
    return filled.trimEnd()
}

/** One output key in words: its name, type, bounds, where it comes from and what it holds. */
const describeOutput = (item: ResolvedOutput): string => {
    const { spec } = item
    const facts = [
        spec.type,
        ...("minItems" in spec && spec.minItems !== undefined && spec.minItems > 0 ? [`at least ${String(spec.minItems)}`] : []),
        ...("cites" in spec && spec.cites === "context" ? ["ids named by the files you read that are not marked background"] : []),
        ...("cites" in spec && spec.cites === "work" ? ["ids named by the Work files you read or the records you wrote in your allowPaths"] : []),
        item.source,
    ]
    const summary = "summary" in spec && spec.summary !== undefined ? `: ${spec.summary}` : ""
    return `${code(item.key)} (${facts.join(", ")})${summary}`
}

/**
 * Renders the brief a worker reads: the common procedure of ops/ops/README.md, then the task's op and its resolved contract
 * (base then extend) in plain words, with a "Prior work" section when earlier tasks of the same key left work (prior.ts);
 * `role` is who works it (an Orca worker, or the inline chat agent).
 */
export const renderBrief = (task: TaskRow, ops: Ops, root: string, files: BriefFiles, role: Role = "worker"): string => {
    const { contract } = task
    const resolved = resolveContract(contract, ops)
    const { op } = resolved
    const checks = resolveChecks(contract, ops)
    const prior = priorWorkSection(root, task)
    // The ids the contract hands this task, each with the text it resolves to, so a grader reads what the author decided by.
    const handed = citesBriefSection(contract.cites, ops.root, resolved.output.some((item) => item.key === GRADES_KEY))
    const cites = handed === undefined ? [] : ["### Cites", handed]
    const cli =slashed(fileURLToPath(new URL("../main.js", import.meta.url)))
    const values = { taskId: task.id, contractFile: slashed(files.contract), outputFile: slashed(files.output) }
    const template = fillTemplate(workerProcedure(ops), join(ops.dir, OP_FILES, OPS_README), values)
    const procedure = fillTemplate(op.procedure, op.file, values)
    const inputs = resolved.inputs.map((input) => {
        const summary = input.summary === undefined ? "" : `: ${input.summary}`
        return `${input.name} (${input.source}${summary}): ${input.value}`
    })
    const sections = [
        `# Worker brief\n\n${template}`,
        `## Task ${task.id}`,
        [
            `Label: ${contract.label} (${op.summary})`,
            `Try: ${String(task.tryNo)} of ${String(contract.budget.tries)}`,
            `Repository: ${slashed(root)}`,
            `Revision: ${contract.context.revision}`,
            `Working folder: ${contract.context.cwd ?? "the repository root"}`,
            `CLI: \`starci\`; when it is not on PATH, run \`node ${cli}\` in its place`,
            // Orca's worker-start has no flag to set the worker's environment, so the role travels in the brief.
            `Role: ${role}. Run every starci command with ${ROLE_ENV}=${role} in its environment (sh: \`${ROLE_ENV}=${role} starci ...\`; PowerShell: \`$env:${ROLE_ENV}='${role}'\`); a verb your role may not run refuses ROLE_REFUSED`,
        ]
            .map((fact) => `- ${fact}`)
            .join("\n"),
        ...(prior === undefined ? [] : ["### Prior work", prior]),
        `### The ${contract.label} op`,
        procedure,
        "### Input",
        [contract.input.summary, contract.input.details, inputs.length === 0 ? undefined : bullets(inputs, "none")].filter((part) => part !== undefined && part !== "").join("\n\n"),
        "### Write only under",
        bullets(contract.context.allowPaths, "nothing"),
        "### Read exactly these files",
        bullets(
            // A shared file is background every task of the label reads; its ids are never cited (citableContext).
            resolved.context.map((file) => `${slashed(contextPath(file, ops, root))} (${file.source}${file.shared ? ", background: not citable" : ""})`),
            "none: the input and the files under allowPaths are the whole context",
        ),
        ...cites,
        "### Output",
        resolved.output.length === 0
            ? `Write ${code(values.outputFile)} as one json object; no key is required.`
            : `Write ${code(values.outputFile)} as one json object with these keys:\n\n${bullets(resolved.output.map(describeOutput), "none")}`,
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
