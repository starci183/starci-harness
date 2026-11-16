import { existsSync, readFileSync, statSync } from "node:fs"
import { basename, dirname, join, posix, relative, resolve } from "node:path"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"
import { mainCheckout, repositoryRoot, samePath } from "../shared/git.js"
import { locateTree } from "../shared/tree.js"
import { ensureLedgerId, findLedgerId } from "./ledger.js"

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

const WORK_SEGMENT = /^[a-z0-9][a-z0-9-]*$/

/**
 * The file that holds the Work record `id`, repository-relative, or undefined for no Work id: `brand` is
 * `.starciwork/brand/index.yaml` and `environment.<name>` its resource.yaml (the inverse of lanes.ts recordOfPath).
 */
export const recordFileOfId = (id: string): string | undefined => {
    if (id === "brand") return posix.join(WORK_DIR, "brand", "index.yaml")
    const [family, name, ...rest] = id.split(".")
    if (family !== "environment" || name === undefined || !WORK_SEGMENT.test(name) || rest.length > 0) return undefined
    return posix.join(WORK_DIR, "_resources", "environments", name, "resource.yaml")
}
