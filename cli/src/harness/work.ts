import { randomBytes } from "node:crypto"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { basename, dirname, join, posix, relative, resolve } from "node:path"
import { parse, stringify } from "yaml"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"
import { captureGit, mainCheckout, repositoryRoot } from "../shared/git.js"
import { locateTree } from "../shared/tree.js"
import { CONTRACT_SCHEMA, DEFAULT_BUDGET, resolveChecks } from "./contract.js"
import type { Contract } from "./contract.js"
import { ensureLedgerId, findLedgerId } from "./ledger.js"
import type { Ops } from "./ops.js"
import { CHECKS_FILE, RECEIPT_FILE, fileSha256, readReceipt, storeBlob } from "./uat.js"
import type { UatReceipt } from "./uat.js"

/** The folder of a repository that holds its product Work; the repository that has it is a Work root. */
export const WORK_DIR = ".starciwork"

/** The part of an app's hfs.json this module reads: where the project's Work root is, relative to that hfs.json. */
const hfsWorkSchema = z.object({ work: z.object({ root: z.string().min(1) }).optional() })

/** Where a project's Work lives: the repository root that owns `.starciwork`, and how it was found. */
export interface WorkRoot {
    readonly root: string
    readonly from: "self" | "hfs.json"
    readonly hfs: string | undefined
}

/** True when two paths name the same folder (case-folded on Windows). */
export const samePath = (left: string, right: string): boolean => {
    const fold = (path: string): string => {
        const full = resolve(path).replaceAll("\\", "/")
        return process.platform === "win32" ? full.toLowerCase() : full
    }
    return fold(left) === fold(right)
}

const readHfsWork = (file: string): string | undefined => {
    let raw: unknown
    try {
        raw = JSON.parse(readFileSync(file, "utf8"))
    } catch (error: unknown) {
        throw new Refusal("WORK_HFS_INVALID", `${file} is not readable json: ${error instanceof Error ? error.message : String(error)}`)
    }
    const parsed = hfsWorkSchema.safeParse(raw)
    if (!parsed.success) throw new Refusal("WORK_HFS_INVALID", `${file}: ${z.prettifyError(parsed.error)}`)
    return parsed.data.work?.root
}

/**
 * The Work root of the project `cwd` belongs to: the repository its hfs.json names in `work.root` (relative to that hfs.json),
 * else its own repository when that one holds `.starciwork`. A repository holding `.starciwork` while its hfs.json names
 * another root is ambiguous and refused, so Work is never written in two places.
 */
export const locateWorkRoot = async (cwd: string): Promise<WorkRoot> => {
    const own = await repositoryRoot(cwd)
    const treeRoot = locateTree(cwd).root
    const hfs = treeRoot === undefined ? undefined : join(treeRoot, "hfs.json")
    const declared = hfs === undefined || !existsSync(hfs) ? undefined : readHfsWork(hfs)
    const ownsWork = existsSync(join(own, WORK_DIR))
    if (declared === undefined) {
        if (ownsWork) return { root: own, from: "self", hfs }
        const naming = hfs === undefined ? "has no hfs.json naming a Work root" : `${hfs} names no Work root`
        throw new Refusal(
            "WORK_ROOT_UNKNOWN",
            `${own} holds no ${WORK_DIR} and ${naming}; add "work": {"root": "<path of the repository holding ${WORK_DIR}>"} to the app's hfs.json`,
        )
    }
    const target = resolve(dirname(hfs ?? own), declared)
    if (!existsSync(target) || !statSync(target).isDirectory()) throw new Refusal("WORK_ROOT_MISSING", `${hfs ?? "hfs.json"} names the Work root ${declared}, but ${target} is no folder`)
    const root = await repositoryRoot(target)
    if (!existsSync(join(root, WORK_DIR))) throw new Refusal("WORK_ROOT_MISSING", `${hfs ?? "hfs.json"} names the Work root ${declared}, but the repository ${root} holds no ${WORK_DIR}`)
    if (ownsWork && !samePath(root, own)) {
        throw new Refusal("WORK_ROOT_AMBIGUOUS", `${own} holds its own ${WORK_DIR} while ${hfs ?? "hfs.json"} names ${root} as the Work root; keep one of the two`)
    }
    return { root, from: "hfs.json", hfs }
}

/** A project: the main checkout of the repository that owns its Work, its ledger id (the key of its one Supervisor) and its name. */
export interface Project {
    readonly root: string
    readonly key: string
    readonly name: string
}

const projects = new Map<string, Project>()

/**
 * The project a folder belongs to, the one rule every Supervisor verb and sweep resolves by: the repository that owns the Work
 * (`locateWorkRoot`, read from the folder's main checkout so a workflow worktree resolves as its repository does, a side
 * repository through its hfs.json `work.root`), else, for a repository that holds no Work and names none, the repository itself.
 * `mint` false (a read verb) registers no ledger: an unregistered project has the empty key, so it has no Supervisor.
 */
export const projectOf = async (cwd: string, mint = true): Promise<Project> => {
    const known = projects.get(resolve(cwd))
    if (known !== undefined) return known
    const main = await mainCheckout(cwd)
    let owner = main
    try {
        owner = (await locateWorkRoot(join(main, relative(await repositoryRoot(cwd), resolve(cwd))))).root
    } catch (error: unknown) {
        if (!(error instanceof Refusal) || error.code !== "WORK_ROOT_UNKNOWN") throw error
    }
    const root = resolve(await mainCheckout(owner))
    const key = mint ? ensureLedgerId(root) : findLedgerId(root)
    const project: Project = { root, key: key ?? "", name: basename(root) }
    if (key !== undefined) projects.set(resolve(cwd), project)
    return project
}

const SEGMENT = "[a-z0-9][a-z0-9-]*"

const WORK_SEGMENT = new RegExp(String.raw`^${SEGMENT}$`)

const UAT_ID = new RegExp(String.raw`^uat\.(${SEGMENT})\.(${SEGMENT}(?:\.${SEGMENT})*)$`)

/** Where a uat flow's files live, repository-relative with forward slashes: its folder, record, runs folder and evidence file. */
export interface UatPlace {
    readonly id: string
    readonly dir: string
    readonly record: string
    readonly runs: string
    readonly evidence: string
}

/** The place of `uat.<feature>.<flow>`: `.starciwork/features/<feature>/uat/<flow>/`, a dotted flow nesting by folder. */
export const uatPlace = (id: string): UatPlace => {
    const match = UAT_ID.exec(id)
    const feature = match?.[1]
    const flow = match?.[2]
    if (feature === undefined || flow === undefined) throw new Refusal("WORK_ID_INVALID", `${id} is no uat flow id; write it as uat.<feature>.<flow> (lower-case, digits and dashes)`)
    const dir = posix.join(WORK_DIR, "features", feature, "uat", ...flow.split("."))
    return { id, dir, record: posix.join(dir, "index.yaml"), runs: posix.join(dir, "runs"), evidence: posix.join(dir, "evidence.yaml") }
}

/**
 * The file that holds the Work record `id`, repository-relative, or undefined for no Work id: `brand` is
 * `.starciwork/brand/index.yaml`, `environment.<name>` its resource.yaml, and `<family>.<feature>.<name...>` is
 * `.starciwork/features/<feature>/<family>/<name...>/index.yaml` (the inverse of lanes.ts recordOfPath).
 */
export const recordFileOfId = (id: string): string | undefined => {
    if (id === "brand") return posix.join(WORK_DIR, "brand", "index.yaml")
    const parts = id.split(".")
    if (!parts.every((part) => WORK_SEGMENT.test(part))) return undefined
    const [family, feature, ...name] = parts
    if (family === "environment" && feature !== undefined && name.length === 0) return posix.join(WORK_DIR, "_resources", "environments", feature, "resource.yaml")
    if (family === undefined || feature === undefined || name.length < (family === "impl" ? 2 : 1)) return undefined
    return posix.join(WORK_DIR, "features", feature, family, ...name, "index.yaml")
}

/** The place of the flow whose record file is `record` (as a uat-flow check names it). */
export const placeOfRecord = (record: string): Omit<UatPlace, "id"> => {
    const dir = posix.dirname(record)
    return { dir, record, runs: posix.join(dir, "runs"), evidence: posix.join(dir, "evidence.yaml") }
}

const valueSchema = z.union([z.string(), z.number(), z.boolean()])

const stepSchema = z.object({
    order: z.number().int().positive(),
    actor: z.string().min(1).optional(),
    action: z.string().min(1),
    expected: z.string().min(1),
    checks: z.array(z.object({ id: z.string().min(1), expected: valueSchema })).optional(),
})

// contexts/project/work.md owns this vocabulary; `blocked` is the activity a red walk leaves until the Kernel acts.
const WORK_STATES = ["todo", "done"] as const

const WORK_ACTIVITIES = ["idle", "investigating", "implementing", "verifying", "blocked"] as const

/** A Work record of schema work/uat-flow@1, as far as the harness reads it; keys it does not read are left as they are. */
export const uatFlowSchema = z
    .object({
        schema: z.literal("work/uat-flow@1"),
        id: z.string().min(1),
        title: z.string().min(1),
        state: z.enum(WORK_STATES),
        activity: z.enum(WORK_ACTIVITIES),
        entry: z.string().min(1),
        actor: z.string().min(1),
        accounts: z.string().min(1).optional(),
        steps: z.array(stepSchema).min(1),
    })
    .superRefine((record, issues) => {
        const orders = record.steps.map((step) => step.order)
        const doubled = orders.filter((order, index) => orders.indexOf(order) !== index)
        if (doubled.length > 0) issues.addIssue({ code: "custom", path: ["steps"], message: `step order ${doubled.join(", ")} is named twice` })
    })

/** A parsed uat flow record. */
export type UatFlow = z.infer<typeof uatFlowSchema>

const readYamlText = (text: string, where: string): unknown => {
    try {
        return parse(text)
    } catch (error: unknown) {
        throw new Refusal("WORK_RECORD_INVALID", `${where} is not readable yaml: ${error instanceof Error ? error.message : String(error)}`)
    }
}

/** Parses and validates the text of a uat flow record; `where` names it in a refusal. */
export const parseUatRecord = (text: string, where: string): UatFlow => {
    const parsed = uatFlowSchema.safeParse(readYamlText(text, where))
    if (!parsed.success) throw new Refusal("WORK_RECORD_INVALID", `${where} is no valid work/uat-flow@1 record: ${z.prettifyError(parsed.error)}`)
    return parsed.data
}

/** A uat record read from a Work root: its place, its parsed content and its text. */
export interface UatRecordFile {
    readonly place: UatPlace
    readonly record: UatFlow
    readonly text: string
}

/** Reads and validates the record of `id` under `root`; the record's own id must be the one asked for. */
export const readUatRecord = (root: string, id: string): UatRecordFile => {
    const place = uatPlace(id)
    const file = join(root, place.record)
    if (!existsSync(file)) throw new Refusal("WORK_RECORD_MISSING", `no record ${id} in ${root}: ${place.record} does not exist`)
    const text = readFileSync(file, "utf8")
    const record = parseUatRecord(text, place.record)
    if (record.id !== id) throw new Refusal("WORK_RECORD_INVALID", `${place.record} carries id ${record.id}, not ${id}`)
    return { place, record, text }
}

/** The name of the screenshot of one step in the run folder: step-01.png, step-02.png ... */
export const screenshotOf = (order: number, record: UatFlow): string => {
    const width = Math.max(2, String(Math.max(...record.steps.map((step) => step.order))).length)
    return `step-${String(order).padStart(width, "0")}.png`
}

/** The walk report every run folder holds beside its screenshots. */
export const REPORT_FILE = "report.md"

/** A fresh run id for a uat task sent by hand: UTC time plus a random suffix, so run folders sort in walk order. */
export const freshRunId = (): string => `${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}-${randomBytes(2).toString("hex")}`

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

const SUMMARY_CHARS = 100

const flat = (text: string): string => text.replace(/\s+/g, " ").trim()

const shortTitle = (title: string): string => {
    const line = flat(title)
    if (line.length <= SUMMARY_CHARS) return line
    const cut = line.slice(0, SUMMARY_CHARS)
    return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), SUMMARY_CHARS / 2)).trimEnd()} ...`
}

const quoted = (value: z.infer<typeof valueSchema>): string => JSON.stringify(value)

const ordered = (record: UatFlow): UatFlow["steps"] => [...record.steps].sort((left, right) => left.order - right.order)

const checkLines = (step: UatFlow["steps"][number]): string[] => {
    if (step.checks === undefined || step.checks.length === 0) return []
    const listed = step.checks.map((check) => check.id + " = " + quoted(check.expected)).join(", ")
    return ["   Checks: " + listed]
}

const stepLines = (record: UatFlow): string[] =>
    ordered(record).flatMap((step) => [
        `${String(step.order)}. [${step.actor ?? record.actor}] ${flat(step.action)}`,
        `   Expected: ${flat(step.expected)}`,
        `   Screenshot: ${screenshotOf(step.order, record)}`,
        ...checkLines(step),
    ])

/**
 * The contract@2 of a uat task built from a Work record; the uat op (ops/ops/uat.md) adds its base, whose uat-flow check takes
 * the `record` and `run` inputs. The run folder `<flow>/runs/<runId>` is its only write path (git-ignored, so raw output never
 * lands); its extend reads the record and its accounts file (named, never its values), puts the steps in the details and asks
 * one `steps` entry per record step. `runId` is fresh for a task sent by hand and
 * `<workflow>-<task key>` for a workflow node, so a replan sees the same contract.
 */
export const uatContract = (file: UatRecordFile, options: { readonly revision: string; readonly runId: string }): Contract => {
    const { place, record } = file
    if (!RUN_ID.test(options.runId)) throw new Refusal("WORK_RUN_INVALID", `${options.runId} is no run id (letters, digits, dot, dash, underscore)`)
    const run = posix.join(place.runs, options.runId)
    const accounts = record.accounts === undefined ? undefined : posix.join(place.dir, record.accounts)
    const details = [
        `Walk the Work flow ${place.id} (${place.record}) in a real browser with \`starci uat run <script> --out ${run}\`.`,
        `Title: ${flat(record.title)}`,
        `Entry: ${record.entry}`,
        `Actor: ${record.actor}`,
        accounts === undefined
            ? "Accounts: the record names no accounts file."
            : `Accounts: ${accounts} names the account of each role; sign in with them and never copy a secret value into the script, the run or the result.`,
        `Run folder: ${run}. Keep the walk script there (for example ${posix.join(run, "walk.mjs")}); write ${REPORT_FILE} there (what you walked and saw per step). The folder is git-ignored: the harness keeps a receipt of each run and cites the folder by digest in ${place.evidence} when it settles the task.`,
        "Steps:",
        ...stepLines(record),
        `Observations: the script itself, during the run, saves one screenshot per step (page.screenshot, PNG) under the name above and writes ${CHECKS_FILE} in its working directory: {"steps": [{"order": <n>, "status": "passed" | "failed" | "skipped", "screenshot": "<name>", "checks": {"<check id>": <value read from the page>}, "observed": "<what the page showed>"}]}, one entry per step above, every check id answered with the value the script read. The walk is judged on ${CHECKS_FILE} and the screenshots as the run's receipt holds them; a file written or changed outside \`starci uat run\` does not count.`,
        `Output: besides the keys the brief lists, steps repeats the entries of ${CHECKS_FILE}. The verdict is passed only when every step passed with every check at its expected value; a step you may not walk (an owner authorization is missing) is skipped, never passed.`,
    ].join("\n")
    return {
        schema: CONTRACT_SCHEMA,
        label: "uat",
        context: { revision: options.revision, allowPaths: [run], extend: [place.record, ...(accounts === undefined ? [] : [accounts])] },
        input: { summary: `walk ${place.id}: ${shortTitle(record.title)}`, details, base: { record: place.record, run }, extend: { flow: place.id } },
        output: {
            extend: {
                verdict: { type: "string", summary: "passed only when every step passed with every check at its expected value, else failed" },
                steps: { type: "array", minItems: record.steps.length, summary: "one entry per record step: order, status, screenshot, checks, observed" },
            },
        },
        budget: { ...DEFAULT_BUDGET },
    }
}

/** The record and run folder a uat task's uat-flow check names. */
export interface UatBinding {
    readonly record: string
    readonly run: string
}

/** The binding of a contract that walks a Work flow; undefined for any other contract. */
export const uatBinding = (contract: Contract, ops: Ops): UatBinding | undefined => {
    for (const { check } of resolveChecks(contract, ops)) if (check.kind === "uat-flow") return { record: check.record, run: check.run }
    return undefined
}

/**
 * Refuses a uat walk whose run folder git in `root` would commit (a run's raw output stays git-ignored) or whose evidence file
 * git ignores (no settle could cite the run). Every uat contract is checked so before it is queued or recorded in a workflow.
 */
export const assertRunPlace = async (root: string, binding: UatBinding): Promise<void> => {
    if ((await ignoredBy(root, posix.join(binding.run, REPORT_FILE))) === undefined) {
        throw new Refusal("WORK_RUNS_TRACKED", `git in ${root} would commit ${binding.run}; a run's raw output stays git-ignored, so ignore runs/ in the Work tree's .gitignore`)
    }
    const evidence = placeOfRecord(binding.record).evidence
    const rule = await ignoredBy(root, evidence)
    if (rule !== undefined) throw new Refusal("WORK_EVIDENCE_IGNORED", `git in ${root} ignores ${evidence} (${rule}); un-ignore it so a settle can cite the run`)
}

/** The files of a run folder, relative to it with forward slashes; none when it does not exist. */
export const runFiles = (folder: string): string[] => {
    if (!existsSync(folder)) return []
    return readdirSync(folder, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => relative(folder, join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
        .sort((a, b) => (a < b ? -1 : Number(a > b)))
}

/** The uat result a worker files, as far as the uat-flow check reads it. */
const uatResultSchema = z.object({
    verdict: z.enum(["passed", "failed"]),
    steps: z.array(
        z.object({
            order: z.number().int().positive(),
            status: z.enum(["passed", "failed", "skipped"]),
            screenshot: z.string().min(1).optional(),
            checks: z.record(z.string(), valueSchema).optional(),
        }),
    ),
})

/** One reason a walk is not green; `step` names the record step it is about, when it is about one. */
export interface UatProblem {
    readonly step?: number
    readonly text: string
}

/** The judgement of a filed uat result against its record: green only when every step matched and the verdict says passed. */
export interface UatJudgement {
    readonly green: boolean
    readonly problems: readonly UatProblem[]
    readonly failingStep: number | undefined
}

const insideFolder = (file: string): boolean => !file.startsWith("/") && !/^[A-Za-z]:/.test(file) && !file.replaceAll("\\", "/").split("/").includes("..")

/** Why a step's screenshot does not count, or undefined when it does; the name is relative to the run folder. */
type ShotProblem = (shot: string) => string | undefined

const stepProblems = (step: UatFlow["steps"][number], entries: readonly z.infer<typeof uatResultSchema>["steps"][number][], shotProblem: ShotProblem): UatProblem[] => {
    const order = step.order
    const at = `step ${String(order)}`
    const entry = entries[0]
    if (entry === undefined) return [{ step: order, text: `${at} has no entry in the result` }]
    const problems: UatProblem[] = []
    if (entries.length > 1) problems.push({ step: order, text: `${at} is answered ${String(entries.length)} times` })
    if (entry.status !== "passed") problems.push({ step: order, text: `${at} is ${entry.status}` })
    for (const check of step.checks ?? []) {
        const answer = entry.checks?.[check.id]
        if (answer === undefined) problems.push({ step: order, text: `${at} does not answer check ${check.id}` })
        else if (String(answer) !== String(check.expected)) problems.push({ step: order, text: `${at} check ${check.id} is ${quoted(answer)}, expected ${quoted(check.expected)}` })
    }
    const shot = entry.screenshot
    if (shot === undefined) problems.push({ step: order, text: `${at} names no screenshot` })
    else if (!insideFolder(shot)) problems.push({ step: order, text: `${at} screenshot ${shot} lies outside the run folder` })
    else {
        const why = shotProblem(posix.normalize(shot.replaceAll("\\", "/")))
        if (why !== undefined) problems.push({ step: order, text: `${at} screenshot ${shot} ${why}` })
    }
    return problems
}

/** The problems of every record step against the walked entries, plus entries for steps the record does not have. */
const walkProblems = (record: UatFlow, steps: z.infer<typeof uatResultSchema>["steps"], shotProblem: ShotProblem): UatProblem[] => {
    const known = new Set(record.steps.map((step) => step.order))
    const problems: UatProblem[] = steps.filter((entry) => !known.has(entry.order)).map((entry) => ({ text: `the walk answers step ${String(entry.order)}, which the record does not have` }))
    for (const step of ordered(record)) {
        problems.push(
            ...stepProblems(
                step,
                steps.filter((entry) => entry.order === step.order),
                shotProblem,
            ),
        )
    }
    return problems
}

const judgement = (problems: UatProblem[]): UatJudgement => {
    const steps = problems.map((problem) => problem.step).filter((step): step is number => step !== undefined)
    return { green: problems.length === 0, problems, failingStep: steps.length === 0 ? undefined : Math.min(...steps) }
}

/** The verdict's agreement: a claim of passed over a walk with problems, or of failed over a clean one, is a problem itself. */
const verdictProblems = (verdict: "passed" | "failed", problems: readonly UatProblem[], whose: string): UatProblem[] => {
    if (problems.length === 0 && verdict !== "passed") return [{ text: `${whose} verdict is ${verdict}, though every step matched the record` }]
    if (problems.length > 0 && verdict === "passed") return [{ text: `${whose} verdict claims passed, but the walk does not match the record` }]
    return []
}

/**
 * Judges a filed result by itself (T2) against the record and the run folder's file names (`present`): the report exists, one
 * entry per step, every check at its expected value, a screenshot named in the folder and an agreeing verdict. It explains
 * where a red walk stopped; it never makes a walk green, which only the receipted walk does (judgeUatWalk).
 */
export const judgeUatResult = (record: UatFlow, output: unknown, present: ReadonlySet<string>): UatJudgement => {
    const problems: UatProblem[] = present.has(REPORT_FILE) ? [] : [{ text: `the run folder holds no ${REPORT_FILE}` }]
    const parsed = uatResultSchema.safeParse(output)
    if (!parsed.success) return judgement([...problems, { text: `the result is no uat walk: ${z.prettifyError(parsed.error)}` }])
    problems.push(...walkProblems(record, parsed.data.steps, (shot) => (present.has(shot) ? undefined : "is not in the run folder")))
    return judgement([...problems, ...verdictProblems(parsed.data.verdict, problems, "the result's")])
}

/** What the script observed, as `starci uat run` receipted it: the steps of checks.json. */
const observedSchema = z.object({ steps: uatResultSchema.shape.steps })

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// A PNG opens with its signature and an IHDR chunk whose width and height are not zero.
const PNG_HEADER_BYTES = 24

/** True when the file is a PNG with a real image header. */
const isPng = (path: string): boolean => {
    const bytes = readFileSync(path)
    if (bytes.length < PNG_HEADER_BYTES || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return false
    return bytes.toString("latin1", 12, 16) === "IHDR" && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0
}

// A file's mtime may trail the container's clock by this much on a bind mount and still be inside the run.
const WINDOW_SLACK_MS = 5000

/**
 * Why a file of the run folder is no receipted observation, or undefined when it is: the receipt names it as written during the
 * run, within the run's window, and the folder still holds those exact bytes.
 */
const receiptedProblem = (receipt: UatReceipt, folder: string, name: string): string | undefined => {
    const entry = receipt.files.find((file) => file.path === name)
    if (entry === undefined) return "is not in the receipt of the run"
    if (!entry.written) return "was not written by the run (it was in the folder before the container started)"
    const start = Date.parse(receipt.startedAt) - WINDOW_SLACK_MS
    const end = Date.parse(receipt.endedAt) + WINDOW_SLACK_MS
    if (entry.mtimeMs < start || entry.mtimeMs > end) return `was written at ${new Date(entry.mtimeMs).toISOString()}, outside the run ${receipt.startedAt} .. ${receipt.endedAt}`
    const file = join(folder, name)
    if (!existsSync(file)) return "is gone from the run folder"
    return fileSha256(file) === entry.sha256 ? undefined : "changed after the run (its digest differs from the receipt)"
}

/** The receipt's own problems: none kept, a run that did not end with exit 0, or a folder copy that is not the harness's. */
const receiptProblems = (folder: string): { readonly receipt?: UatReceipt; readonly problems: UatProblem[] } => {
    const kept = readReceipt(folder)
    if (kept === undefined) return { problems: [{ text: `the run folder has no receipt of \`starci uat run\`; walk it with \`starci uat run <script> --out <run folder>\`, never by hand` }] }
    const { receipt } = kept
    const problems: UatProblem[] = []
    if (receipt.timedOut) problems.push({ text: `the receipted run timed out (${receipt.container})` })
    else if (receipt.exitCode !== 0) problems.push({ text: `the receipted run exited ${String(receipt.exitCode)} (${receipt.container})` })
    const copy = join(folder, RECEIPT_FILE)
    if (!existsSync(copy) || fileSha256(copy) !== kept.sha256) problems.push({ text: `${RECEIPT_FILE} in the run folder is not the receipt the harness keeps` })
    return { receipt, problems }
}

/** The receipted checks.json of a run, or the problem that keeps it from counting. */
const observedOf = (receipt: UatReceipt, folder: string): { readonly steps: z.infer<typeof observedSchema>["steps"] } | { readonly problem: string } => {
    const why = receiptedProblem(receipt, folder, CHECKS_FILE)
    if (why !== undefined) return { problem: `${CHECKS_FILE} ${why}; the walk script writes it during the run` }
    let raw: unknown
    try {
        raw = JSON.parse(readFileSync(join(folder, CHECKS_FILE), "utf8"))
    } catch (error: unknown) {
        return { problem: `${CHECKS_FILE} is not json: ${error instanceof Error ? error.message : String(error)}` }
    }
    const parsed = observedSchema.safeParse(raw)
    return parsed.success ? { steps: parsed.data.steps } : { problem: `${CHECKS_FILE} is no walk: ${z.prettifyError(parsed.error)}` }
}

/**
 * Judges a uat walk on what the harness can stand behind. The steps come from the run folder's checks.json (T1: written by the
 * script during a `starci uat run` whose receipt holds its digest), each screenshot must be a PNG the run wrote with its digest in
 * the receipt, and the run must have exited 0. The filed result (T2) only has to agree: its verdict can make the walk red, never green.
 */
export const judgeUatWalk = (record: UatFlow, folder: string, claimed: unknown): UatJudgement => {
    const { receipt, problems } = receiptProblems(folder)
    if (receipt === undefined) return judgement(problems)
    if (!existsSync(join(folder, REPORT_FILE))) problems.push({ text: `the run folder holds no ${REPORT_FILE}` })
    const observed = observedOf(receipt, folder)
    if ("problem" in observed) return judgement([...problems, { text: observed.problem }])
    problems.push(
        ...walkProblems(record, observed.steps, (shot) => {
            const why = receiptedProblem(receipt, folder, shot)
            if (why !== undefined) return why
            return isPng(join(folder, shot)) ? undefined : "is no PNG image"
        }),
    )
    const claim = z.object({ verdict: z.enum(["passed", "failed"]) }).safeParse(claimed)
    if (!claim.success) return judgement([...problems, { text: "the result names no verdict (passed or failed)" }])
    return judgement([...problems, ...verdictProblems(claim.data.verdict, problems, "the result's")])
}

// The tail keeps a trailing comment and a CRLF line end as they are.
const TOP_SCALAR = (key: string): RegExp => new RegExp(String.raw`^(${key}:[ \t]*)([^\s#]+)([^\n]*)$`)

const withoutKeys = (value: unknown, keys: readonly string[]): string => {
    const record = typeof value === "object" && value !== null ? { ...(value as Record<string, unknown>) } : {}
    for (const key of keys) record[key] = undefined
    return JSON.stringify(record)
}

/**
 * The record's text with only its top-level `state` (left as it is when undefined) and `activity` changed, every other byte
 * kept (line endings and comments included). The text is parsed back and refused unless exactly those fields differ.
 */
export const writeRecordState = (text: string, fields: { readonly state?: UatFlow["state"]; readonly activity: UatFlow["activity"] }, where: string): string => {
    const before = parseUatRecord(text, where)
    const lines = text.split("\n")
    const set = (key: string, value: string): void => {
        const pattern = TOP_SCALAR(key)
        const index = lines.findIndex((line) => pattern.test(line))
        if (index < 0) throw new Refusal("WORK_RECORD_UNWRITABLE", `${where} has no top-level \`${key}: <value>\` line to set`)
        lines[index] = (lines[index] ?? "").replace(pattern, (_match: string, head: string, _old: string, tail: string) => `${head}${value}${tail}`)
    }
    if (fields.state !== undefined) set("state", fields.state)
    set("activity", fields.activity)
    const next = lines.join("\n")
    const after = parseUatRecord(next, where)
    const kept = withoutKeys(readYamlText(text, where), ["state", "activity"]) === withoutKeys(readYamlText(next, where), ["state", "activity"])
    if (!kept || after.state !== (fields.state ?? before.state) || after.activity !== fields.activity) {
        throw new Refusal("WORK_RECORD_UNWRITABLE", `${where}: setting state and activity would change more of the record; it is left as it was`)
    }
    return next
}

/** One run a flow's evidence file cites: the task, when it settled, its verdict, where it failed, and every file by digest. */
export const evidenceRunSchema = z.object({
    run: z.string().min(1),
    task: z.string().min(1),
    at: z.string().min(1),
    verdict: z.enum(["passed", "failed"]),
    path: z.string().min(1),
    step: z.number().int().positive().optional(),
    reason: z.string().min(1).optional(),
    files: z.array(z.object({ path: z.string().min(1), sha256: z.string().regex(/^[0-9a-f]{64}$/) })),
})

/** A run as the evidence file cites it. */
export type EvidenceRun = z.infer<typeof evidenceRunSchema>

/** A flow's `evidence.yaml` (work/evidence@1): the runs that walked it, oldest first; written only by the harness at settle. */
const evidenceFileSchema = z.object({ schema: z.literal("work/evidence@1"), record: z.string().min(1), runs: z.array(evidenceRunSchema) })

/**
 * The digests of a run folder's files, for the evidence file, each file stored under its digest in the harness store
 * (`<state base>/blobs/sha256/`), so every digest evidence.yaml cites, the receipt's copy included, still resolves to its bytes
 * after the git-ignored run folder is cleaned.
 */
export const digestRun = (folder: string): EvidenceRun["files"] => runFiles(folder).map((path) => ({ path, sha256: storeBlob(join(folder, path)) }))

/** The evidence file's text with `run` appended; `text` is its current content, undefined when the flow has none yet. */
export const appendEvidence = (text: string | undefined, record: string, run: EvidenceRun, where: string): string => {
    let runs: EvidenceRun[] = []
    if (text !== undefined) {
        const parsed = evidenceFileSchema.safeParse(readYamlText(text, where))
        if (!parsed.success) throw new Refusal("WORK_EVIDENCE_INVALID", `${where} is no valid work/evidence@1 file: ${z.prettifyError(parsed.error)}`)
        if (parsed.data.record !== record) throw new Refusal("WORK_EVIDENCE_INVALID", `${where} cites runs of ${parsed.data.record}, not ${record}`)
        runs = parsed.data.runs
    }
    const file: z.infer<typeof evidenceFileSchema> = { schema: "work/evidence@1", record, runs: [...runs, evidenceRunSchema.parse(run)] }
    return stringify(file, { lineWidth: 0 })
}

/** The rule of the repository's ignore files that ignores `path`, or undefined when git would track it. */
export const ignoredBy = async (root: string, path: string): Promise<string | undefined> => {
    const run = await captureGit(["check-ignore", "-v", "--no-index", "--", path], root)
    return run.exitCode === 0 ? run.stdout : undefined
}
