// `starci check [--release]` is the harness's own check; `starci release gate` is its deprecated spelling, which prints the rename on stderr and runs the
// same check. `starci check` is also the group of `check lint`, `check secrets`...: the group's options stay its own, a subcommand's stay the subcommand's.
// Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { ALL_VERBS } from "../../registry.js"
import { checkVerb, releaseGateVerb, renamedGateNotice } from "./gate.js"

const MAIN = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "main.js")

void test("starci check is the harness check and release gate is its alias with the same flags", () => {
    assert.deepEqual(checkVerb.path, ["check"])
    assert.deepEqual(releaseGateVerb.path, ["release", "gate"])
    assert.deepEqual(Object.keys(releaseGateVerb.flags), Object.keys(checkVerb.flags))
    assert.ok(Object.keys(checkVerb.flags).includes("release"))
    assert.ok(ALL_VERBS.some((verb) => verb.path.length === 1 && verb.path[0] === "check"))
    assert.equal(renamedGateNotice("full"), "renamed: use starci check --release")
    assert.equal(renamedGateNotice("dev"), "renamed: use starci check")
    assert.equal(renamedGateNotice(undefined), "renamed: use starci check")
})

void test("--release is the full level: with another --level it is a usage refusal", async () => {
    await assert.rejects(
        checkVerb.run({ cwd: tmpdir(), tree: "runtime", treeRoot: tmpdir(), verbs: [], json: true, progress: () => undefined } as never, { release: true, level: "dev", base: undefined, fresh: false }),
        /--release is the full level/,
    )
})

void test("the command line routes starci check, its alias and its subcommands, each to its own flags", () => {
    const outside = mkdtempSync(join(tmpdir(), "starci-check-rename-"))
    try {
        const run = (args: readonly string[]) => spawnSync(process.execPath, [MAIN, "--json", ...args], { cwd: outside, encoding: "utf8" })
        const both = run(["check", "--release", "--level", "dev"])
        assert.match(both.stdout, /--release is the full level/, both.stdout + both.stderr)
        const alias = run(["release", "gate", "--release", "--level", "dev"])
        assert.match(alias.stderr, /^renamed: use starci check --release$/m, alias.stderr)
        assert.match(alias.stdout, /--release is the full level/)
        // A subcommand's --base is its own: the check group never takes it, so the subcommand parses (and does not report an unknown option).
        const lint = run(["check", "secrets", "--base", "HEAD"])
        assert.doesNotMatch(lint.stdout + lint.stderr, /--release is the full level|unknown option/)
    } finally {
        rmSync(outside, { recursive: true, force: true })
    }
})
