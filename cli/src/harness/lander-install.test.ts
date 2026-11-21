// The batch lander resolves its own install: a CLI inside a worktree of the app (the app checkout's node_modules) runs the lander again from
// `<lanes>/_lander-cli/<version>`, installed once through a staging folder; a CLI outside every worktree runs as it is. Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import type { ToolRun } from "../shared/exec.js"
import { LANDER_OWN_INSTALL_ENV, checkoutHolding, landerEntry, landerHome, landerInstallDir } from "./lander-install.js"

const NAME = "starci-harness"
const VERSION = "1.1.0-alpha.190"

const scratch = (t: { after: (fn: () => void) => void }): { readonly app: string; readonly lanes: string } => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "starci-lander-install-")))
    t.after(() => {
        rmSync(base, { recursive: true, force: true })
    })
    const app = join(base, "app")
    mkdirSync(join(app, "node_modules", NAME, "dist"), { recursive: true })
    const lanes = join(base, "lanes")
    mkdirSync(lanes)
    return { app, lanes }
}

/** An npm that installs the package by writing its entry into the folder it runs in, logging each call. */
const fakeNpm = (calls: string[], exitCode = 0) => (args: readonly string[], cwd: string): Promise<ToolRun> => {
    calls.push(`${args.join(" ")} in ${cwd}`)
    const manifest = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as { dependencies: Record<string, string> }
    assert.equal(manifest.dependencies[NAME], VERSION)
    if (exitCode === 0) {
        mkdirSync(dirname(landerEntry(cwd, NAME)), { recursive: true })
        writeFileSync(landerEntry(cwd, NAME), "")
    }
    return Promise.resolve({ exitCode, stdout: "", stderr: exitCode === 0 ? "" : "npm error 404 Not Found", timedOut: false })
}

void test("a lander started from an app checkout's node_modules runs from its own install, installed once per version", async (t) => {
    const { app, lanes } = scratch(t)
    const cliRoot = join(app, "node_modules", NAME)
    assert.equal(checkoutHolding(cliRoot, [join(lanes, "_batch-lander"), app]), app)
    const calls: string[] = []
    const said: string[] = []
    const options = { cliRoot, worktrees: [app, join(lanes, "_batch-lander")], dir: lanes, name: NAME, version: VERSION, env: {}, say: (line: string) => said.push(line), npm: fakeNpm(calls) }
    const entry = await landerHome(options)
    assert.equal(entry, landerEntry(landerInstallDir(lanes, VERSION), NAME))
    assert.ok(existsSync(entry))
    assert.equal(calls.length, 1)
    assert.ok(said.some((line) => line.includes("not from") && line.includes(app)))
    assert.equal(await landerHome(options), entry)
    assert.equal(calls.length, 1, "an install in place is reused")
})

void test("a lander outside every worktree runs as it is; started again and still inside one, it refuses instead of looping", async (t) => {
    const { app, lanes } = scratch(t)
    const own = landerInstallDir(lanes, VERSION)
    const calls: string[] = []
    const base = { worktrees: [app, join(lanes, "_batch-lander")], dir: lanes, name: NAME, version: VERSION, env: {}, say: () => undefined, npm: fakeNpm(calls) }
    assert.equal(await landerHome({ ...base, cliRoot: join(own, "node_modules", NAME) }), undefined)
    assert.equal(await landerHome({ ...base, cliRoot: join(dirname(lanes), "harness", "cli") }), undefined)
    await assert.rejects(landerHome({ ...base, cliRoot: join(app, "node_modules", NAME), env: { [LANDER_OWN_INSTALL_ENV]: "1" } }), (error: unknown) => error instanceof Error && "code" in error && error.code === "LANE_LANDER_INSTALL")
    assert.deepEqual(calls, [])
})

void test("a failed install of the lander's own copy refuses and leaves no half install where the lander would run from", async (t) => {
    const { app, lanes } = scratch(t)
    const calls: string[] = []
    await assert.rejects(
        landerHome({ cliRoot: join(app, "node_modules", NAME), worktrees: [app], dir: lanes, name: NAME, version: VERSION, env: {}, say: () => undefined, npm: fakeNpm(calls, 1) }),
        (error: unknown) => error instanceof Error && "code" in error && error.code === "LANE_LANDER_INSTALL" && error.message.includes("404"),
    )
    assert.equal(existsSync(landerInstallDir(lanes, VERSION)), false)
    assert.deepEqual(readdirSync(join(lanes, "_lander-cli")), [], "the staging folder is removed too")
})
