import { existsSync, mkdirSync, statSync } from "node:fs"
import { basename, dirname, isAbsolute, relative, resolve } from "node:path"
import { appUnserved, containerName, dockerServer, fileSha256, fileStamps, loadUat, pagesOf, prepareImage, RECEIPT_FILE, receiptFiles, receiptPath, RESERVED_ENV_PREFIX, runContainer, tailOf, UAT_APP_UNSERVED, withoutPages, writeReceipt } from "../../harness/uat.js"
import type { Prepared, UatReceipt } from "../../harness/uat.js"
import { Refusal, UsageError } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { prepareWorkspace } from "../check/workspace-deps.js"
import type { StepResult } from "../check/scope.js"

/** What one uat run did: the image, the forwards, the variables handed in (names only), the script's arguments, the evidence it wrote and the script's verdict. */
interface UatRunData {
    /** The workspace dependencies the walk's checkout was given before the run (core/check/workspace-deps.ts prepareWorkspace). */
    readonly workspace: readonly StepResult[]
    /** The pages the walk opened and how many answered 5xx, as the relay tallied them; null when it printed no tally. */
    readonly pages: { readonly opened: number; readonly serverErrors: number } | null
    readonly image: string
    readonly prepared: Prepared
    readonly docker: string
    readonly container: string
    readonly script: string
    readonly forwards: readonly number[]
    readonly env: readonly string[]
    readonly args: readonly string[]
    readonly out: string
    readonly files: readonly string[]
    readonly receipt: string
    readonly receiptSha256: string
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

const ENV_NAME = /^[A-Za-z_]\w*$/

/**
 * The names of --env: each a variable name, none the harness's own, each set in this process's environment (else
 * UAT_ENV_MISSING, naming only the names). The values are never read here: docker takes them from the environment it inherits.
 */
const envOf = (value: string | undefined): string[] => {
    const names = [...new Set((value ?? "").split(",").map((entry) => entry.trim()).filter((entry) => entry !== ""))]
    for (const name of names) {
        if (!ENV_NAME.test(name)) throw new UsageError(`--env takes variable names as NAME,NAME,...; "${name}" is not one`)
        if (name.startsWith(RESERVED_ENV_PREFIX)) throw new UsageError(`--env ${name}: ${RESERVED_ENV_PREFIX}* variables are the harness's own in the container`)
    }
    const missing = names.filter((name) => process.env[name] === undefined)
    if (missing.length > 0) throw new Refusal("UAT_ENV_MISSING", `--env names ${missing.join(", ")}, which ${missing.length === 1 ? "is" : "are"} not set in this process's environment; set ${missing.length === 1 ? "it" : "them"} in the shell that runs starci`)
    return names
}

const timeoutOf = (value: string | undefined, fallback: number): number => {
    if (value === undefined) return fallback
    const ms = Math.round(Number(value) * 1000)
    if (value.trim() === "" || !Number.isFinite(ms) || ms < 1) throw new UsageError(`--timeout takes a positive number of seconds, not "${value}"`)
    return ms
}

// docker --mount splits on commas, so a path holding one cannot be mounted faithfully.
const mountable = (path: string, what: string): string => {
    if (path.includes(",")) throw new Refusal("UAT_PATH_UNMOUNTABLE", `the ${what} path ${path} holds a comma, which docker --mount cannot take`)
    return path
}

// A folder outside git is a project of its own (contexts/harness/state.md), so its evidence root is the working directory.
const repositoryOrCwd = async (cwd: string): Promise<string> => {
    try {
        return resolve(await repositoryRoot(cwd))
    } catch (error: unknown) {
        if (error instanceof Refusal && error.code === "GIT_NOT_A_REPOSITORY") return cwd
        throw error
    }
}

/** The evidence folder under the repository root: its mountable absolute path and its path from the root; a folder outside the root is refused. */
const evidenceFolder = (root: string, outFlag: string): { readonly out: string; readonly fromRoot: string } => {
    if (isAbsolute(outFlag)) throw new Refusal("UAT_OUT_OUTSIDE", `--out is relative to the repository root ${root}, not absolute: ${outFlag}`)
    const out = mountable(resolve(root, outFlag), "evidence")
    const fromRoot = relative(root, out)
    if (fromRoot === "" || fromRoot.startsWith("..") || isAbsolute(fromRoot)) throw new Refusal("UAT_OUT_OUTSIDE", `--out ${outFlag} must name a folder inside the repository root ${root}`)
    return { out, fromRoot }
}

/** The progress note naming the forwarded ports, empty when none. */
const forwardNote = (forwards: readonly number[]): string => (forwards.length === 0 ? "" : ", forwarding " + forwards.join(", ") + " to the host")

/** The line naming how the image was made ready. */
const imageNote = (data: UatRunData): string => {
    const { prepared } = data
    if (prepared.state === "cached") return "cached as " + prepared.runImage
    const pulled = prepared.pulledBase ? " after pulling the base" : ""
    return `built ${prepared.runImage}${pulled} in ${(prepared.durationMs / 1000).toFixed(1)} s`
}

/** The verdict line of a run: the deadline it hit, or its exit code. */
const verdictOf = (data: UatRunData, timeoutMs: number): string => {
    if (data.timedOut) return `timed out after ${String(timeoutMs)} ms; ${data.container} was killed`
    return `exit ${String(data.exitCode)} (${data.exitCode === 0 ? "green" : "red"}) in ${(data.durationMs / 1000).toFixed(1)} s`
}

/** The line naming what the walk's checkout was given before the run. */
const workspaceNote = (steps: readonly StepResult[]): string =>
    steps.length === 0 ? "workspace: every workspace dependency the app imports is built" : `workspace: ${steps.map((one) => `${one.package} ${one.status} (${one.reason})`).join("; ")}`

/** The line naming the pages the walk opened. */
const pagesNote = (pages: UatRunData["pages"]): string =>
    pages === null ? "pages: no tally (the run printed none)" : `pages: ${String(pages.opened)} opened, ${String(pages.serverErrors)} answered 5xx`

/** The human lines of a run, before the tails of its streams. */
const describeRun = (data: UatRunData, timeoutMs: number): string[] => {
    const forwards = data.forwards.length === 0 ? "none" : data.forwards.map((port) => `127.0.0.1:${String(port)}`).join(", ")
    const env = data.env.length === 0 ? "none" : data.env.join(", ") + " (by name)"
    const args = data.args.length === 0 ? "none" : JSON.stringify(data.args)
    const files = data.files.length === 0 ? "no files written" : data.files.join(", ")
    return [
        workspaceNote(data.workspace),
        `image ${data.image} (${imageNote(data)})`,
        `forwards ${forwards}`,
        `env ${env}; args ${args}`,
        `evidence ${data.out}: ${files}`,
        `receipt ${data.receipt} (sha256 ${data.receiptSha256.slice(0, 12)}), its copy ${RECEIPT_FILE} in the folder`,
        pagesNote(data.pages),
        verdictOf(data, timeoutMs),
        `container ${data.container} ${data.removed ? "removed" : "STILL PRESENT (docker rm --force it)"}`,
    ]
}

/**
 * Gives the checkout the walk serves the app from what a wave gives the checkout it judges (core/check/workspace-deps.ts
 * prepareWorkspace: the install with the project's local package sources, then its workspace dependencies, each under the heavy
 * governor), before any container runs; an install or a dependency that cannot be given refuses UAT_APP_SETUP_FAILED, the walk's
 * environment failing, never a finding of the screens.
 */
const prepareApp = async (root: string, timeoutMs: number, progress: (line: string) => void): Promise<readonly StepResult[]> => {
    const steps = await prepareWorkspace(root, { timeoutMs })
    for (const one of steps) progress(`workspace: ${one.package} ${one.status} (${one.reason})`)
    const red = steps.filter((one) => one.status !== "green")
    if (red.length > 0) throw new Refusal("UAT_APP_SETUP_FAILED", `the app's workspace could not be prepared, so the walk would meet no app (an environment failure, not a finding): ${red.map((one) => `${one.package}: ${one.reason}${one.output === "" ? "" : `\n${one.output}`}`).join("\n")}`)
    return steps
}

/** `starci uat run <script>`: runs a Playwright script in the pinned Playwright image, with host ports forwarded on 127.0.0.1 and an evidence folder. */
export const uatRunVerb = defineVerb({
    path: ["uat", "run"],
    summary: "run a Playwright ESM script in the pinned Playwright image (ops/uat.yaml), after giving the checkout what a wave gives the checkout it judges, its install with the project's local @starci package sources (starci deps source --local) and the workspace dependencies its app imports (UAT_APP_SETUP_FAILED when one cannot be given): host ports forwarded on 127.0.0.1, named variables and -- arguments handed to it, its evidence folder at /evidence; exit 0 is green. The harness keeps a receipt of the run (script digest, image, container, exit, times, every evidence file by digest in its store), the only source a uat-flow check reads observations from, and the pages the walk opened; a walk whose every page answered 5xx refuses UAT_APP_UNSERVED, an environment failure",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["op", "worker", "agent", "kernel", "supervisor", "owner"],
    schema: "starci/uat-run@1",
    flags: {
        script: { kind: "string", summary: "the script (.mjs): `import { chromium } from \"playwright\"`, work at top level, relative paths land in /evidence", required: true, positional: true },
        forward: { kind: "string", summary: "host ports the browser reaches on 127.0.0.1 inside the container (port,port,...)" },
        out: { kind: "string", summary: "the evidence folder, relative to the repository root, created (default uat-evidence/<container>)" },
        timeout: { kind: "string", summary: "seconds to the deadline of the run; the container is killed and removed at it (default ops/uat.yaml timeoutMs)" },
        image: { kind: "string", summary: "another official Playwright image (<repo>:v<x.y.z>-<distro>) instead of the pinned one" },
        env: { kind: "string", summary: "variables of this process's environment handed to the script by name only (NAME,NAME,...); the values never reach argv or the output" },
        args: { kind: "rest", summary: "after --: arguments handed to the script as process.argv" },
    },
    run: async (context, flags) => {
        const config = loadUat()
        const forwards = portsOf(flags.forward)
        const env = envOf(flags.env)
        const timeoutMs = timeoutOf(flags.timeout, config.timeoutMs)
        const image = flags.image ?? config.image
        const script = resolve(context.cwd, flags.script)
        if (!existsSync(script) || !statSync(script).isFile()) throw new Refusal("UAT_SCRIPT_MISSING", `${script} is not a file`)
        const scriptDir = mountable(dirname(script), "script folder")
        const container = containerName()
        const root = await repositoryOrCwd(context.cwd)
        const { out, fromRoot } = evidenceFolder(root, flags.out ?? `uat-evidence/${container}`)
        const workspace = await prepareApp(root, config.prepareTimeoutMs, context.progress)
        const docker = await dockerServer(context.cwd)
        const prepared = await prepareImage(config, image, context.cwd, context.progress)
        mkdirSync(out, { recursive: true })
        const before = fileStamps(out)
        const scriptSha256 = fileSha256(script)
        context.progress(`running ${basename(script)} as ${container} in ${prepared.runImage}${forwardNote(forwards)}`)
        const startedAt = new Date().toISOString()
        const run = await runContainer({ container, runImage: prepared.runImage, scriptDir, scriptName: basename(script), outDir: out, forwards, timeoutMs, shmSize: config.shmSize, env, args: flags.args }, context.cwd)
        const endedAt = new Date().toISOString()
        // The harness's receipt of what it ran and saw: a uat-flow check reads observations only through it.
        const stored = receiptFiles(out, before)
        const pages = pagesOf(run.stderr)
        const receipt: UatReceipt = {
            schema: "starci/uat-receipt@1",
            folder: out.replaceAll("\\", "/"),
            script: { path: script.replaceAll("\\", "/"), sha256: scriptSha256 },
            image,
            runImage: prepared.runImage,
            container,
            exitCode: run.exitCode,
            timedOut: run.timedOut,
            startedAt,
            endedAt,
            files: stored,
            ...(pages === undefined ? {} : { pages }),
        }
        const receiptSha256 = writeReceipt(receipt)
        const files = stored.filter((file) => file.written).map((file) => file.path)
        const outPath = fromRoot.replaceAll("\\", "/")
        if (appUnserved(receipt)) {
            throw new Refusal(
                UAT_APP_UNSERVED,
                `every page the walk opened answered 5xx (${String(pages?.opened ?? 0)} of ${String(pages?.opened ?? 0)}): the app was not served, so nothing of it was judged; this is an environment failure, never a finding of the screens. File the task's result as it stands, with no finding: the harness ends the attempt as its own failure and dispatches the task again at the same try. Receipt ${receiptPath(out).replaceAll("\\", "/")} (sha256 ${receiptSha256.slice(0, 12)})\n--- stderr (tail)\n${tailOf(withoutPages(run.stderr), config.tailLines)}`,
            )
        }
        const data: UatRunData = {
            workspace,
            pages: pages ?? null,
            image,
            prepared,
            docker,
            container,
            script,
            forwards,
            env,
            args: flags.args,
            out: outPath,
            files,
            receipt: receiptPath(out).replaceAll("\\", "/"),
            receiptSha256,
            exitCode: run.exitCode,
            timedOut: run.timedOut,
            removed: run.removed,
            durationMs: run.durationMs,
            stdoutTail: tailOf(run.stdout, config.tailLines),
            stderrTail: tailOf(withoutPages(run.stderr), config.tailLines),
        }
        const lines = describeRun(data, timeoutMs)
        if (data.stdoutTail !== "") lines.push("--- stdout (tail)", data.stdoutTail)
        if (data.stderrTail !== "") lines.push("--- stderr (tail)", data.stderrTail)
        return { data, message: lines.join("\n"), ...(run.exitCode === 0 && run.removed ? {} : { exitCode: 1 }) }
    },
})
