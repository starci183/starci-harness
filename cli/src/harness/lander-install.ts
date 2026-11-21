import { existsSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Refusal } from "../shared/errors.js"
import { captureNpm } from "../shared/exec.js"
import type { ToolRun } from "../shared/exec.js"
import { PORT } from "../core/deps/local-registry.js"

/**
 * The batch lander runs from its own install, never from a checkout's `node_modules`. Started as `npx starci lane land` in the app's main dev
 * checkout it ran from that checkout's `node_modules/starci-harness`, so a `dev sync` (or any `npm ci`) of the checkout wiped the files
 * under the running lander: it lost its own ops/ folder and looped on OPS_NOT_FOUND. Its `_batch-lander` worktree is no home either:
 * the lander itself runs `npm ci` there whenever a batch's lockfile moves. So a lander started from inside any worktree of the app
 * repository installs the same starci-harness version once into `<lanes>/_lander-cli/<version>` (a folder nothing else installs into,
 * staged and renamed into place) and runs itself again from there. A lander started from outside every worktree (a global install, the
 * harness checkout's own build, or that install) runs as it is.
 */

/** Set in the lander that was started again from its own install: one that still finds itself inside a worktree refuses instead of looping. */
export const LANDER_OWN_INSTALL_ENV = "STARCI_LANDER_OWN_INSTALL"

/** The root of the starci-harness package this process runs (dist/harness/ is two levels below it). */
export const runningCliRoot = (): string => fileURLToPath(new URL("../..", import.meta.url))

const real = (path: string): string => {
    try {
        return realpathSync(path)
    } catch {
        return resolve(path)
    }
}

const inside = (outer: string, inner: string): boolean => {
    const rel = relative(process.platform === "win32" ? real(outer).toLowerCase() : real(outer), process.platform === "win32" ? real(inner).toLowerCase() : real(inner))
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

/** The worktree of the app repository that holds the running CLI, or undefined when it runs from outside every one of them. */
export const checkoutHolding = (cliRoot: string, worktrees: readonly string[]): string | undefined => worktrees.find((tree) => inside(tree, cliRoot))

/** The lander's own install of one starci-harness version under the lanes folder. Pure. */
export const landerInstallDir = (dir: string, version: string): string => join(dir, "_lander-cli", version)

/** The entry of the starci-harness package an install holds. Pure. */
export const landerEntry = (install: string, name: string): string => join(install, "node_modules", name, "dist", "main.js")

/**
 * The lander's own install of `name@version`, installed when absent: npm installs it into a staging folder beside it, renamed into place
 * once it holds the entry, so a failed or interrupted install never leaves a half one where the lander runs from. A `-local.` version
 * comes from the local registry. Returns the entry to run.
 */
export const ensureLanderInstall = async (dir: string, name: string, version: string, say: (line: string) => void, npm: (args: readonly string[], cwd: string) => Promise<ToolRun> = captureNpm): Promise<string> => {
    const install = landerInstallDir(dir, version)
    const entry = landerEntry(install, name)
    if (existsSync(entry)) return entry
    const staging = `${install}.staging-${String(process.pid)}`
    rmSync(staging, { recursive: true, force: true })
    mkdirSync(staging, { recursive: true })
    writeFileSync(join(staging, "package.json"), `${JSON.stringify({ name: "starci-lander-cli", private: true, dependencies: { [name]: version } }, null, 2)}\n`)
    say(`installing ${name}@${version} as the lander's own install in ${install} (once per version)`)
    const registry = version.includes("-local.") ? [`--registry=http://127.0.0.1:${String(PORT)}/`] : []
    const run = await npm(["install", "--no-audit", "--no-fund", "--omit=dev", ...registry], staging)
    if (run.exitCode !== 0 || !existsSync(landerEntry(staging, name))) {
        rmSync(staging, { recursive: true, force: true })
        throw new Refusal("LANE_LANDER_INSTALL", `npm install ${name}@${version} for the lander's own install in ${install} failed: ${[run.stdout, run.stderr].join("\n").trim().split("\n").slice(-8).join("\n")}`)
    }
    rmSync(install, { recursive: true, force: true })
    renameSync(staging, install)
    return entry
}

/**
 * Where the lander runs from: undefined when the running CLI lies outside every worktree of the app repository (it runs here), else the
 * entry of its own install to run again from. A lander already started again that still finds itself in a worktree refuses.
 */
export const landerHome = async (options: { readonly cliRoot: string; readonly worktrees: readonly string[]; readonly dir: string; readonly name: string; readonly version: string; readonly env: NodeJS.ProcessEnv; readonly say: (line: string) => void; readonly npm?: (args: readonly string[], cwd: string) => Promise<ToolRun> }): Promise<string | undefined> => {
    const holder = checkoutHolding(options.cliRoot, options.worktrees)
    if (holder === undefined) return undefined
    if (options.env[LANDER_OWN_INSTALL_ENV] === "1") throw new Refusal("LANE_LANDER_INSTALL", `the lander was started again from its own install, yet runs from ${options.cliRoot} inside the worktree ${holder}`)
    const entry = await ensureLanderInstall(options.dir, options.name, options.version, options.say, options.npm)
    options.say(`the lander runs from its own install ${entry}, not from ${holder}'s node_modules (a dev sync or npm ci there would wipe it under the running lander)`)
    return entry
}
