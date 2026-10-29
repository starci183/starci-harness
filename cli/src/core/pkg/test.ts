import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { withHeavySlot } from "../../harness/heavy.js"
import type { HeavyKind } from "../../harness/heavy.js"
import { PACKAGE_SCOPE } from "../../harness/needs.js"
import { Refusal } from "../../shared/errors.js"
import { captureCommand } from "../../shared/exec.js"
import { captureGit, git } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb, EVERYONE } from "../../shared/verb.js"
import { appName, BRANCH_PREFIX, changedPackages, harnessRepository } from "./edit.js"

const TAIL_LINES = 30

/** One gate of the package, run in its folder. */
interface Step {
    readonly step: string
    readonly status: "green" | "red"
    readonly exitCode: number
    readonly output: string
}

interface TestData {
    readonly package: string
    readonly worktree: string
    readonly branch: string
    readonly folder: string
    readonly steps: readonly Step[]
    readonly verdict: "green" | "red"
}

/** A package edit worktree of the harness: its path, branch and the time of its head commit. */
interface EditTree {
    readonly path: string
    readonly branch: string
    readonly at: number
}

const scriptsSchema = z.looseObject({ scripts: z.record(z.string(), z.string()).optional() })

/** The folder under `packages/` a package name means: `@starci/<folder>`, or the bare folder. */
const folderOf = (name: string): string => (name.startsWith(PACKAGE_SCOPE) ? name.slice(PACKAGE_SCOPE.length) : name)

/** The package edit worktrees of `app` in the harness (`pkg/<app>-*`) whose branch changes `packages/<folder>`, newest head first. */
const editTreesOf = async (harness: string, app: string, folder: string): Promise<EditTree[]> => {
    const listing = (await captureGit(["worktree", "list", "--porcelain"], harness)).stdout
    const trees: EditTree[] = []
    for (const block of listing.split(/\r?\n\r?\n/)) {
        const path = /^worktree (.+)$/m.exec(block)?.[1]?.trim()
        const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1]?.trim()
        if (path === undefined || branch?.startsWith(`${BRANCH_PREFIX}${app}-`) !== true || !existsSync(join(path, "packages", folder))) continue
        if (!(await changedPackages(path)).includes(folder)) continue
        trees.push({ path, branch, at: Number((await git(path, ["log", "-1", "--format=%ct", "HEAD"])).trim()) })
    }
    return trees.sort((left, right) => right.at - left.at)
}

/** The steps a package's scripts give: its typecheck and lint unless its test script runs them already, then its specs. */
const stepsOf = (scripts: Readonly<Record<string, string>>): { readonly step: string; readonly kind: HeavyKind; readonly argv: readonly string[] }[] => {
    const test = scripts.test ?? ""
    const own = (script: string): boolean => scripts[script] !== undefined && !test.includes(`run ${script}`)
    return [
        ...(own("typecheck") ? [{ step: "typecheck", kind: "tsc" as const, argv: ["npm", "run", "typecheck"] }] : []),
        ...(own("lint") ? [{ step: "lint", kind: "eslint" as const, argv: ["npm", "run", "lint"] }] : []),
        { step: "test", kind: "test" as const, argv: ["npm", "test"] },
    ]
}

/**
 * `starci pkg test <package>`: a package fix's behavioural proof (the `package-specs` check preset). The fix lives on this app's
 * package edit branch (`pkg branch`), outside the task's checkout, so it runs there: in `packages/<folder>` of the newest package
 * edit worktree of this app that changes the package (or `--worktree`), the package's typecheck and lint scripts its test script
 * does not run already, then `npm test`, each under a heavy-command slot (harness/heavy.ts). Red when any exits non-zero.
 */
export const pkgTestVerb = defineVerb({
    path: ["pkg", "test"],
    summary: "run a @starci package's own typecheck, lint and specs (npm test) in packages/<name> of this app's package edit worktree, each under a heavy-command slot; red when any fails",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/pkg-test@1",
    flags: {
        package: { kind: "string", summary: "the package, @starci/<name> or <name>", required: true, positional: true },
        worktree: { kind: "string", summary: "the package edit worktree to test (default: the newest pkg/<app>-* worktree of the harness that changes the package)" },
        harness: { kind: "string", summary: "the harness repository the edit branched from (default the one this CLI runs from)" },
    },
    run: async (context, flags) => {
        const folder = folderOf(flags.package)
        let tree: EditTree | undefined
        if (flags.worktree === undefined) {
            const app = await appName(context.cwd)
            tree = (await editTreesOf(await harnessRepository(flags.harness), app, folder))[0]
            if (tree === undefined) throw new Refusal("PKG_EDIT_MISSING", `no package edit worktree of ${app} (${BRANCH_PREFIX}${app}-*) changes packages/${folder}; cut one with starci pkg branch <topic>, commit the fix there, then test it`)
        } else {
            tree = { path: flags.worktree, branch: (await git(flags.worktree, ["branch", "--show-current"])).trim(), at: 0 }
        }
        const dir = join(tree.path, "packages", folder)
        const manifest = join(dir, "package.json")
        if (!existsSync(manifest)) throw new Refusal("PKG_EDIT_MISSING", `${dir} holds no package.json; ${flags.package} is no package of ${tree.path}`)
        const scripts = scriptsSchema.parse(JSON.parse(readFileSync(manifest, "utf8"))).scripts ?? {}
        if (scripts.test === undefined) throw new Refusal("PKG_NO_SPECS", `${flags.package} has no test script; a package proves itself with its own specs (CONTRIBUTING.md CONTRIB-2): add them and its test script`)
        const steps: Step[] = []
        for (const step of stepsOf(scripts)) {
            const run = await withHeavySlot(step.kind, `${step.step} ${folder}`, dir, {}, (held) => captureCommand(step.argv, dir, held.options))
            steps.push({ step: step.step, status: run.exitCode === 0 ? "green" : "red", exitCode: run.exitCode, output: `${run.stdout}\n${run.stderr}`.trim().split("\n").slice(-TAIL_LINES).join("\n") })
        }
        const verdict = steps.every((step) => step.status === "green") ? "green" : "red"
        const data: TestData = { package: flags.package, worktree: tree.path.replaceAll("\\", "/"), branch: tree.branch, folder: dir.replaceAll("\\", "/"), steps, verdict }
        const unInstalled = verdict === "red" && !existsSync(join(dir, "node_modules")) ? [`${dir} has no node_modules: install it (packages/README.md) before testing`] : []
        const lines = [
            `${flags.package} on ${tree.branch} (${data.worktree})`,
            ...steps.map((step) => `${step.status} ${step.step} (exit ${String(step.exitCode)})`),
            ...steps.filter((step) => step.status === "red").map((step) => `--- ${step.step}\n${step.output}`),
            ...unInstalled,
            `verdict: ${verdict}`,
        ]
        return { data, message: lines.join("\n"), exitCode: verdict === "green" ? 0 : 1 }
    },
})
