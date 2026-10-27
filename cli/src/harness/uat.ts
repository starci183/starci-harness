import { createHash, randomBytes } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"
import { captureTool, headline } from "../shared/exec.js"
import type { ToolRun } from "../shared/exec.js"
import { stateBase } from "./ledger.js"
import { locateOps } from "./ops.js"

const uatSchema = z.object({
    schema: z.literal("starci/uat@1"),
    image: z.string().min(1),
    timeoutMs: z.number().int().positive(),
    prepareTimeoutMs: z.number().int().positive(),
    shmSize: z.string().regex(/^\d+[bkmg]?$/i),
    tailLines: z.number().int().positive(),
})

/** ops/uat.yaml, validated: the pinned Playwright image and the bounds of one run. */
export type UatConfig = z.infer<typeof uatSchema>

/** Loads and validates ops/uat.yaml from the ops folder (STARCI_OPS_DIR honoured). */
export const loadUat = (dir: string = locateOps()): UatConfig => {
    const file = join(dir, "uat.yaml")
    let raw: unknown
    try {
        raw = parse(readFileSync(file, "utf8"))
    } catch (error: unknown) {
        throw new Refusal("OPS_INVALID", `${file} is not readable yaml: ${error instanceof Error ? error.message : String(error)}`)
    }
    const parsed = uatSchema.safeParse(raw)
    if (!parsed.success) throw new Refusal("OPS_INVALID", `${file} is invalid: ${z.prettifyError(parsed.error)}`)
    return parsed.data
}

/** The Playwright version an official image's tag pins (`...:v1.64.1-noble` is 1.64.1); the npm package installed beside its browsers takes it. */
export const playwrightVersionOf = (image: string): string => {
    const version = /:v(\d+\.\d+\.\d+)(?:-[a-z0-9.]+)?$/i.exec(image)?.[1]
    if (version === undefined) throw new Refusal("UAT_IMAGE_UNVERSIONED", `${image} does not name a Playwright version in its tag (expected <repo>:v<x.y.z>-<distro>)`)
    return version
}

// The script's folder, the evidence folder and the entrypoint live at fixed paths inside the container.
const SCRIPT_DIR = "/uat"
const EVIDENCE_DIR = "/evidence"
const PREAMBLE = "/opt/starci-uat/preamble.mjs"

// The playwright package goes to /node_modules: ESM resolution walks up from /uat/<script> to it, which NODE_PATH cannot do.
const dockerfileOf = (image: string, version: string): string =>
    [
        `FROM ${image}`,
        `RUN npm install --prefix /opt/starci-uat/pkg --no-audit --no-fund --loglevel=error playwright@${version} \\`,
        " && mv /opt/starci-uat/pkg/node_modules /node_modules \\",
        " && rm -rf /opt/starci-uat/pkg",
        `COPY preamble.mjs ${PREAMBLE}`,
        `WORKDIR ${EVIDENCE_DIR}`,
        `ENTRYPOINT ["node", "${PREAMBLE}"]`,
        "",
    ].join("\n")

const preambleFile = (): string => join(dirname(fileURLToPath(import.meta.url)), "uat-preamble.js")

/** How the run image was obtained: already on the host, or built now (with the base pulled when it was missing). */
export interface Prepared {
    readonly runImage: string
    readonly state: "cached" | "built"
    readonly pulledBase: boolean
    readonly durationMs: number
}

const imageExists = async (image: string, cwd: string): Promise<boolean> => (await captureTool("docker", ["image", "inspect", "--format", "{{.Id}}", image], cwd)).exitCode === 0

/**
 * The local run image: the pinned base plus the matching playwright package and the forwarding preamble, tagged by a hash of
 * all three, so it is built once per host and rebuilt only when one of them changes. A failed build tags nothing.
 */
export const prepareImage = async (config: UatConfig, image: string, cwd: string, progress: (line: string) => void): Promise<Prepared> => {
    const started = Date.now()
    const version = playwrightVersionOf(image)
    const preamble = readFileSync(preambleFile(), "utf8")
    const dockerfile = dockerfileOf(image, version)
    const hash = createHash("sha256").update(dockerfile).update(preamble).digest("hex").slice(0, 12)
    const runImage = `starci-uat:${version}-${hash}`
    if (await imageExists(runImage, cwd)) return { runImage, state: "cached", pulledBase: false, durationMs: Date.now() - started }
    const pulledBase = !(await imageExists(image, cwd))
    const pulling = pulledBase ? "pulling " + image + ", " : ""
    progress(`preparing ${runImage} once: ${pulling}installing playwright@${version}`)
    const context = mkdtempSync(join(tmpdir(), "starci-uat-image-"))
    try {
        writeFileSync(join(context, "Dockerfile"), dockerfile)
        copyFileSync(preambleFile(), join(context, "preamble.mjs"))
        const labels = ["--label", "starci.uat=1", "--label", `starci.uat.base=${image}`, "--label", `starci.uat.playwright=${version}`]
        const build = await captureTool("docker", ["build", "--tag", runImage, ...labels, context], cwd, { timeoutMs: config.prepareTimeoutMs })
        if (build.exitCode !== 0) {
            const failure = headline(build.stderr) || "exit " + String(build.exitCode)
            const why = build.timedOut ? "timed out after " + String(config.prepareTimeoutMs) + " ms" : failure
            throw new Refusal("UAT_PREPARE_FAILED", `building ${runImage} from ${image} failed: ${why}`)
        }
    } finally {
        rmSync(context, { recursive: true, force: true })
    }
    return { runImage, state: "built", pulledBase, durationMs: Date.now() - started }
}

/** Refuses unless a Linux Docker engine answers; returns its server version. */
export const dockerServer = async (cwd: string): Promise<string> => {
    const info = await captureTool("docker", ["info", "--format", "{{.OSType}} {{.ServerVersion}}"], cwd, { timeoutMs: 30_000 })
    if (info.exitCode !== 0) {
        const why = headline(info.stderr) || "exit " + String(info.exitCode)
        throw new Refusal("UAT_DOCKER_UNREACHABLE", `no Docker engine answers: ${why}`)
    }
    const [os, version] = info.stdout.split(" ")
    if (os !== "linux") throw new Refusal("UAT_DOCKER_NOT_LINUX", `the Docker engine runs ${os ?? "an unknown OS"} containers; the uat image needs Linux containers`)
    return version ?? ""
}

/** Every file under a folder with its size and mtime, keyed by its forward-slash path relative to the folder. */
export const fileStamps = (dir: string): Map<string, string> => {
    const stamps = new Map<string, string>()
    if (!existsSync(dir)) return stamps
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile()) continue
        const path = join(entry.parentPath, entry.name)
        const stat = statSync(path)
        stamps.set(relative(dir, path).replaceAll("\\", "/"), `${String(stat.size)}:${String(stat.mtimeMs)}`)
    }
    return stamps
}

/** The last `count` lines of a tool's output. */
export const tailOf = (text: string, count: number): string => text.split("\n").slice(-count).join("\n")

/** What one container run did: its exit code (EXIT_TIMEOUT when the deadline killed it), its output and whether the container is gone. */
export interface UatRun {
    readonly removed: boolean
    readonly exitCode: number
    readonly timedOut: boolean
    readonly stdout: string
    readonly stderr: string
    readonly durationMs: number
}

/** A fresh container name, `starci-uat-<random>`; `docker ps -a --filter name=starci-uat-` lists any left behind. */
export const containerName = (): string => `starci-uat-${randomBytes(4).toString("hex")}`

/**
 * One container run of a script: its name, its folder, its evidence folder, the ports to forward, the deadline, the names of
 * the harness environment variables handed in (`env`) and the script's own arguments (`args`).
 */
export interface UatRunSpec {
    readonly container: string
    readonly runImage: string
    readonly scriptDir: string
    readonly scriptName: string
    readonly outDir: string
    readonly forwards: readonly number[]
    readonly timeoutMs: number
    readonly shmSize: string
    readonly env: readonly string[]
    readonly args: readonly string[]
}

/** The prefix of the variables the harness itself sets in the container; a script's --env may not name one. */
export const RESERVED_ENV_PREFIX = "STARCI_UAT_"

// Docker answers 125 when the run itself could not start (a bad mount, a missing image): that is the harness's failure,
// not the script's verdict.
const DOCKER_RUN_FAILED = 125

/**
 * Runs the script in a fresh container (`--rm`) with its folder read-only at /uat and the evidence
 * folder read-write at /evidence (the working directory). Each `env` variable is passed by name only (`--env NAME`): docker
 * reads its value from its own environment, which is this process's, so a secret never reaches argv. `args` follow the image
 * and reach the script as process.argv. At the deadline the docker client is killed and the container force-removed; the
 * container is removed in every case.
 */
export const runContainer = async (spec: UatRunSpec, cwd: string): Promise<UatRun> => {
    const container = spec.container
    const user = typeof process.getuid === "function" && typeof process.getgid === "function" ? ["--user", `${String(process.getuid())}:${String(process.getgid())}`, "--env", "HOME=/tmp"] : []
    // Docker Desktop resolves host.docker.internal itself; a Linux engine needs it mapped to the host gateway.
    const host = process.platform === "linux" ? ["--add-host", "host.docker.internal:host-gateway"] : []
    const args = [
        "run",
        "--rm",
        "--init",
        "--name",
        container,
        "--label",
        "starci.uat=1",
        "--shm-size",
        spec.shmSize,
        ...host,
        ...user,
        "--mount",
        `type=bind,src=${spec.scriptDir},dst=${SCRIPT_DIR},readonly`,
        "--mount",
        `type=bind,src=${spec.outDir},dst=${EVIDENCE_DIR}`,
        "--env",
        `STARCI_UAT_SCRIPT=${SCRIPT_DIR}/${spec.scriptName}`,
        "--env",
        `STARCI_UAT_FORWARD=${spec.forwards.join(",")}`,
        "--env",
        `STARCI_UAT_EVIDENCE=${EVIDENCE_DIR}`,
        ...spec.env.flatMap((name) => ["--env", name]),
        spec.runImage,
        ...spec.args,
    ]
    const started = Date.now()
    let run: ToolRun
    try {
        run = await captureTool("docker", args, cwd, { timeoutMs: spec.timeoutMs })
    } finally {
        // Killing the client leaves the container running; a finished --rm container is already gone and this answers "no such container".
        await captureTool("docker", ["rm", "--force", container], cwd, { timeoutMs: 60_000 })
    }
    const durationMs = Date.now() - started
    const removed = (await captureTool("docker", ["container", "inspect", "--format", "{{.Id}}", container], cwd, { timeoutMs: 60_000 })).exitCode !== 0
    if (run.exitCode === DOCKER_RUN_FAILED && !run.timedOut) throw new Refusal("UAT_DOCKER_FAILED", `docker run could not start ${container}: ${headline(run.stderr)}`)
    return { exitCode: run.exitCode, timedOut: run.timedOut, stdout: run.stdout, stderr: run.stderr, durationMs, removed }
}

/** The copy of its receipt `starci uat run` leaves in the run folder, so a settle that digests the folder cites the receipt. */
export const RECEIPT_FILE = "starci-receipt.json"

/** What a uat script observed, written by the script into its run folder: `{"steps": [{order, status, screenshot, checks, observed}]}`. */
export const CHECKS_FILE = "checks.json"

/** The sha256 of a file's bytes, hex. */
export const fileSha256 = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex")

/** Where the harness store keeps the blob of a digest: `<state base>/blobs/sha256/<first two>/<digest>`, outside every repository. */
export const blobPath = (digest: string): string => join(stateBase(), "blobs", "sha256", digest.slice(0, 2), digest)

/**
 * Copies a file into the content-addressed store under its sha256 (once: a blob already there is the same bytes) and returns
 * the digest, so evidence that cites the digest outlives the git-ignored folder the file came from.
 */
export const storeBlob = (path: string): string => {
    const digest = fileSha256(path)
    const target = blobPath(digest)
    if (!existsSync(target)) {
        mkdirSync(dirname(target), { recursive: true })
        const partial = `${target}.${randomBytes(4).toString("hex")}.partial`
        copyFileSync(path, partial)
        renameSync(partial, target)
    }
    return digest
}

const receiptFileSchema = z.strictObject({
    path: z.string().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    size: z.number().int().min(0),
    mtimeMs: z.number(),
    // written: the run created or changed it (its size or mtime differ from before the container started).
    written: z.boolean(),
})

/** The harness's own record of one `starci uat run`: what ran, in which image, when, how it ended, and every file of its folder by digest. */
export const uatReceiptSchema = z.strictObject({
    schema: z.literal("starci/uat-receipt@1"),
    folder: z.string().min(1),
    script: z.strictObject({ path: z.string().min(1), sha256: z.string().regex(/^[0-9a-f]{64}$/) }),
    image: z.string().min(1),
    runImage: z.string().min(1),
    container: z.string().min(1),
    exitCode: z.number().int(),
    timedOut: z.boolean(),
    startedAt: z.string().min(1),
    endedAt: z.string().min(1),
    files: z.array(receiptFileSchema),
})

/** A uat run receipt. */
export type UatReceipt = z.infer<typeof uatReceiptSchema>

/** A folder as receipts key it: absolute, forward slashes, case-folded on Windows. */
const folderKey = (folder: string): string => {
    const full = resolve(folder).replaceAll("\\", "/")
    return createHash("sha256")
        .update(process.platform === "win32" ? full.toLowerCase() : full)
        .digest("hex")
}

/** Where the harness keeps the receipt of the latest run into `folder`: `<state base>/uat/receipts/<folder key>.json`. */
export const receiptPath = (folder: string): string => join(stateBase(), "uat", "receipts", `${folderKey(folder)}.json`)

/** The files of the run folder after a run, each stored by digest; `before` holds their stamps from before the container started. */
export const receiptFiles = (folder: string, before: ReadonlyMap<string, string>): UatReceipt["files"] =>
    [...fileStamps(folder)]
        .filter(([path]) => path !== RECEIPT_FILE)
        .sort(([left], [right]) => Number(left > right) - Number(left < right))
        .map(([path, stamp]) => {
            const file = join(folder, path)
            const stat = statSync(file)
            return { path, sha256: storeBlob(file), size: stat.size, mtimeMs: stat.mtimeMs, written: before.get(path) !== stamp }
        })

/** Writes the receipt where the harness keeps it and its copy into the run folder (stored as a blob too); returns the receipt's digest. */
export const writeReceipt = (receipt: UatReceipt): string => {
    const text = `${JSON.stringify(uatReceiptSchema.parse(receipt), null, 2)}\n`
    const kept = receiptPath(receipt.folder)
    mkdirSync(dirname(kept), { recursive: true })
    writeFileSync(kept, text)
    const copy = join(receipt.folder, RECEIPT_FILE)
    writeFileSync(copy, text)
    return storeBlob(copy)
}

/** The receipt the harness keeps for the latest run into `folder` and its digest, or undefined when no run wrote one. */
export const readReceipt = (folder: string): { readonly receipt: UatReceipt; readonly sha256: string } | undefined => {
    const file = receiptPath(folder)
    if (!existsSync(file)) return undefined
    let raw: unknown
    try {
        raw = JSON.parse(readFileSync(file, "utf8"))
    } catch {
        return undefined
    }
    const parsed = uatReceiptSchema.safeParse(raw)
    return parsed.success ? { receipt: parsed.data, sha256: fileSha256(file) } : undefined
}
