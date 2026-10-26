import { existsSync, mkdirSync, statSync } from "node:fs"
import { basename, dirname, isAbsolute, relative, resolve } from "node:path"
import { containerName, dockerServer, fileStamps, loadUat, prepareImage, runContainer, tailOf } from "../../harness/uat.js"
import type { Prepared } from "../../harness/uat.js"
import { Refusal, UsageError } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

/** What one uat run did: the image, the forwards, the evidence it wrote and the script's verdict. */
interface UatRunData {
    readonly image: string
    readonly prepared: Prepared
    readonly docker: string
    readonly container: string
    readonly script: string
    readonly forwards: readonly number[]
    readonly out: string
    readonly files: readonly string[]
    readonly exitCode: number
    readonly timedOut: boolean
    readonly removed: boolean
    readonly durationMs: number
    readonly stdoutTail: string
    readonly stderrTail: string
}

const portsOf = (value: string | undefined): number[] => {
    const entries = (value ?? "").split(",").map((entry) => entry.trim()).filter((entry) => entry !== "")
    const ports = entries.map((entry) => {
        const port = Number(entry)
        if (!/^\d+$/.test(entry) || port < 1 || port > 65535) throw new UsageError(`--forward takes ports 1-65535 as port,port,...; "${entry}" is not one`)
        return port
    })
    return [...new Set(ports)]
}

const timeoutOf = (value: string | undefined, fallback: number): number => {
    if (value === undefined) return fallback
    const ms = Number(value)
    if (!/^\d+$/.test(value) || ms < 1) throw new UsageError(`--timeout-ms takes a whole number of milliseconds, not "${value}"`)
    return ms
}

// docker --mount splits on commas, so a path holding one cannot be mounted faithfully.
const mountable = (path: string, what: string): string => {
    if (path.includes(",")) throw new Refusal("UAT_PATH_UNMOUNTABLE", `the ${what} path ${path} holds a comma, which docker --mount cannot take`)
    return path
}

// A folder outside git is a project of its own (CONTEXT.md), so its evidence root is the working directory.
const repositoryOrCwd = async (cwd: string): Promise<string> => {
    try {
        return resolve(await repositoryRoot(cwd))
    } catch (error: unknown) {
        if (error instanceof Refusal && error.code === "GIT_NOT_A_REPOSITORY") return cwd
        throw error
    }
}

/** `starci uat run <script>`: runs a Playwright script in the pinned Playwright image, with host ports forwarded on 127.0.0.1 and an evidence folder. */
export const uatRunVerb = defineVerb({
    path: ["uat", "run"],
    summary: "run a Playwright ESM script in the pinned Playwright image (ops/uat.yaml): host ports forwarded on 127.0.0.1, its evidence folder at /evidence; exit 0 is green",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["op", "worker", "agent", "kernel", "supervisor", "owner"],
    schema: "starci/uat-run@1",
    flags: {
        script: { kind: "string", summary: "the script (.mjs): `import { chromium } from \"playwright\"`, work at top level, relative paths land in /evidence", required: true, positional: true },
        forward: { kind: "string", summary: "host ports the browser reaches on 127.0.0.1 inside the container (port,port,...)" },
        out: { kind: "string", summary: "the evidence folder, relative to the repository root, created (default uat-evidence/<container>)" },
        "timeout-ms": { kind: "string", summary: "the deadline of the run; the container is killed and removed at it (default ops/uat.yaml timeoutMs)" },
        image: { kind: "string", summary: "another official Playwright image (<repo>:v<x.y.z>-<distro>) instead of the pinned one" },
    },
    run: async (context, flags) => {
        const config = loadUat()
        const forwards = portsOf(flags.forward)
        const timeoutMs = timeoutOf(flags["timeout-ms"], config.timeoutMs)
        const image = flags.image ?? config.image
        const script = resolve(context.cwd, flags.script)
        if (!existsSync(script) || !statSync(script).isFile()) throw new Refusal("UAT_SCRIPT_MISSING", `${script} is not a file`)
        const scriptDir = mountable(dirname(script), "script folder")
        const container = containerName()
        const root = await repositoryOrCwd(context.cwd)
        const outFlag = flags.out ?? `uat-evidence/${container}`
        if (isAbsolute(outFlag)) throw new Refusal("UAT_OUT_OUTSIDE", `--out is relative to the repository root ${root}, not absolute: ${outFlag}`)
        const out = mountable(resolve(root, outFlag), "evidence")
        const fromRoot = relative(root, out)
        if (fromRoot === "" || fromRoot.startsWith("..") || isAbsolute(fromRoot)) throw new Refusal("UAT_OUT_OUTSIDE", `--out ${outFlag} must name a folder inside the repository root ${root}`)
        const docker = await dockerServer(context.cwd)
        const prepared = await prepareImage(config, image, context.cwd, context.progress)
        mkdirSync(out, { recursive: true })
        const before = fileStamps(out)
        context.progress(`running ${basename(script)} as ${container} in ${prepared.runImage}${forwards.length === 0 ? "" : `, forwarding ${forwards.join(", ")} to the host`}`)
        const run = await runContainer({ container, runImage: prepared.runImage, scriptDir, scriptName: basename(script), outDir: out, forwards, timeoutMs, shmSize: config.shmSize }, context.cwd)
        const files = [...fileStamps(out)].filter(([path, stamp]) => before.get(path) !== stamp).map(([path]) => path).sort()
        const outPath = fromRoot.split("\\").join("/")
        const data: UatRunData = {
            image,
            prepared,
            docker,
            container,
            script,
            forwards,
            out: outPath,
            files,
            exitCode: run.exitCode,
            timedOut: run.timedOut,
            removed: run.removed,
            durationMs: run.durationMs,
            stdoutTail: tailOf(run.stdout, config.tailLines),
            stderrTail: tailOf(run.stderr, config.tailLines),
        }
        const verdict = run.timedOut ? `timed out after ${String(timeoutMs)} ms; ${container} was killed` : `exit ${String(run.exitCode)} (${run.exitCode === 0 ? "green" : "red"}) in ${(run.durationMs / 1000).toFixed(1)} s`
        const lines = [
            `image ${image} (${prepared.state === "cached" ? `cached as ${prepared.runImage}` : `built ${prepared.runImage}${prepared.pulledBase ? " after pulling the base" : ""} in ${(prepared.durationMs / 1000).toFixed(1)} s`})`,
            `forwards ${forwards.length === 0 ? "none" : forwards.map((port) => `127.0.0.1:${String(port)}`).join(", ")}`,
            `evidence ${outPath}: ${files.length === 0 ? "no files written" : files.join(", ")}`,
            verdict,
            `container ${container} ${run.removed ? "removed" : "STILL PRESENT (docker rm --force it)"}`,
        ]
        if (data.stdoutTail !== "") lines.push("--- stdout (tail)", data.stdoutTail)
        if (data.stderrTail !== "") lines.push("--- stderr (tail)", data.stderrTail)
        return { data, message: lines.join("\n"), ...(run.exitCode === 0 && run.removed ? {} : { exitCode: 1 }) }
    },
})
