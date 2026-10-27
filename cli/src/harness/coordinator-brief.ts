import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { coordinatorBriefPath, runtimeRoot } from "./ledger.js"
import { loadOps } from "./ops.js"
import type { CoordinatorRole } from "./routing.js"

/** What a coordinator's brief is rendered from. */
export interface CoordinatorBriefInput {
    readonly role: CoordinatorRole
    readonly root: string
    /** The project a Supervisor serves, by name. */
    readonly project?: string
    readonly launchId: string
    readonly agent: string
    readonly model: string
    readonly workflowId?: string
    readonly worktree?: string
}

const slashed = (path: string): string => path.replaceAll("\\", "/")

/**
 * Writes a coordinator's launch brief in its project's state folder (ops/coordinators/<role>.md with its placeholders filled) and returns the
 * short pointer the launch sends, since a whole brief would pass the Windows argv cap.
 */
export const coordinatorBrief = (input: CoordinatorBriefInput): string => {
    const { role, root, launchId } = input
    const file = coordinatorBriefPath(role, launchId, root)
    const cli = slashed(fileURLToPath(new URL("../main.js", import.meta.url)))
    const values: Readonly<Record<string, string>> = {
        runtimeRoot: runtimeRoot(),
        projectRoot: root,
        project: input.project ?? "",
        workflowId: input.workflowId ?? "",
        worktree: input.worktree ?? root,
        launchId,
        agent: input.agent,
        model: input.model,
        cliFile: cli,
    }
    const template = readFileSync(join(loadOps().dir, "coordinators", `${role}.md`), "utf8")
    const body = template.replace(/\{([A-Za-z]+)\}/g, (match: string, key: string) => (key in values ? slashed(values[key] ?? "") : match))
    const attach = role === "supervisor" ? `supervisor attach --launch ${launchId}` : `kernel attach ${input.workflowId ?? ""} --launch ${launchId}`
    const header = `Your first command after reading this whole brief is \`starci ${attach}\`. Use \`node "${cli}"\` when starci is not on PATH. Set STARCI_ROLE=${role} for every StarCi command.\n\n`
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, header + body, "utf8")
    const title = role === "supervisor" ? `[Supervisor] ${input.project ?? ""}` : `[Kernel] ${input.workflowId ?? ""}`
    return `${title} Read the complete brief at ${slashed(file)} before any other action; run its first command. Runtime root: ${slashed(runtimeRoot())}. Project root: ${slashed(root)}.`
}
