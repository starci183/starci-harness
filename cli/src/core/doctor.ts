import { Refusal } from "../shared/errors.js"
import { probeTool, runNpm } from "../shared/exec.js"
import { formatTable } from "../shared/output.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../shared/verb.js"

interface Probe {
    readonly name: string
    readonly required: boolean
    readonly found: string | undefined
}

interface DoctorData {
    readonly tree: string
    readonly treeRoot: string | null
    readonly probes: readonly Probe[]
}

const NODE_MAJOR = 24

const firstLine = (text: string | undefined): string | undefined => text?.split("\n")[0]

/** `starci doctor`: the host tools a verb may need, and the StarCi tree this directory belongs to. */
export const doctorVerb = defineVerb({
    path: ["doctor"],
    summary: "check Node, git, npm and gh on this host and report the StarCi tree of the working directory",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/doctor@1",
    flags: {},
    run: async (context) => {
        const nodeMajor = Number(process.versions.node.split(".")[0])
        const probes: Probe[] = [
            { name: "node", required: true, found: nodeMajor >= NODE_MAJOR ? process.versions.node : undefined },
            { name: "git", required: true, found: firstLine(await probeTool("git", ["--version"], context.cwd)) },
            { name: "npm", required: true, found: firstLine(await runNpm(["--version"], context.cwd).then((output) => output.stdout, () => undefined)) },
            { name: "gh", required: false, found: firstLine(await probeTool("gh", ["--version"], context.cwd)) },
        ]
        const missing = probes.filter((probe) => probe.required && probe.found === undefined)
        if (missing.length > 0) {
            const names = missing.map((probe) => (probe.name === "node" ? `node (>= ${String(NODE_MAJOR)}, found ${process.versions.node})` : probe.name))
            throw new Refusal("DOCTOR_TOOL_MISSING", `missing or too old: ${names.join(", ")}`)
        }
        const data: DoctorData = { tree: context.tree, treeRoot: context.treeRoot ?? null, probes }
        const table = formatTable(probes.map((probe) => [probe.name, probe.found ?? (probe.required ? "MISSING" : "absent"), probe.required ? "required" : "optional"]))
        return { data, message: `tree: ${context.tree}${context.treeRoot === undefined ? "" : ` (${context.treeRoot})`}\n${table}` }
    },
})
