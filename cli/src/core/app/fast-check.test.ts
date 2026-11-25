// The two-level gate: `app check --level dev` is the fast level of a landing on dev (the deps check with dev-local pins allowed, then @starci/hfs's fast
// families), once per push; a push of dev or a lane branch and lane gate use it; main, a release tag and the release verbs use the full level
// (core/app/fast-check.ts, push.ts, core/lane/gate.ts).
import assert from "node:assert/strict"
import test from "node:test"
import { Refusal } from "../../shared/errors.js"
import type { VerbResult } from "../../shared/verb.js"
import { LANE_CHECK_ARGS } from "../lane/gate.js"
import type { PushTarget } from "../deps/dev-local.js"
import { fastTarget, levelOfTarget, pushRefsOf, pushTargetOfArgs, runFastCheck } from "./fast-check.js"
import type { FastPorts } from "./fast-check.js"
import { FULL_CHECK_ARGS, warmAndPush } from "./push.js"
import type { PushPorts } from "./push.js"

const ZERO = "0".repeat(40)
const line = (ref: string): string => `refs/heads/x ${"a".repeat(40)} ${ref} ${ZERO}`

void test("a landing on dev is detected from the target: every ref dev or a lane branch; main, a tag or another branch is the full level", () => {
    assert.equal(levelOfTarget(pushTargetOfArgs(["origin", "HEAD:dev"], "lane/x")), "dev", "a push of dev")
    assert.equal(levelOfTarget(pushTargetOfArgs(["-u", "origin", "HEAD"], "lane/x")), "dev", "a lane push of its own branch")
    assert.equal(levelOfTarget(pushTargetOfArgs(["--json", "origin", "HEAD:lane/x"], "lane/x")), "dev")
    assert.equal(levelOfTarget(pushTargetOfArgs([], "dev")), "dev", "no refspec: the current branch")
    assert.equal(levelOfTarget(pushTargetOfArgs(["origin", "main"], "main")), "full")
    assert.equal(levelOfTarget(pushTargetOfArgs(["origin", "HEAD:main", "HEAD:dev"], "dev")), "full", "main in the same push is the full level")
    assert.equal(levelOfTarget(pushTargetOfArgs(["origin", "refs/tags/v1.2.0"], "main")), "full")
    assert.equal(levelOfTarget(pushTargetOfArgs(["origin", "feature/y"], "feature/y")), "full")
    assert.equal(levelOfTarget(pushTargetOfArgs([], undefined)), "full", "a detached HEAD with no refspec names nothing")
    assert.deepEqual(fastTarget(undefined).refs, ["refs/heads/dev"], "a dev-level check with no push refs judges for dev")
    assert.deepEqual(fastTarget(`${line("refs/heads/lane/x")}\n`).refs, ["refs/heads/lane/x"])
})

void test("the lane push uses the fast level; the full push path uses the full level", () => {
    assert.deepEqual(LANE_CHECK_ARGS, ["app", "check", "--env", "prod", "--level", "dev", "--json"])
    assert.deepEqual(FULL_CHECK_ARGS, ["app", "check", "--env", "prod", "--level", "full", "--json"])
})

interface World {
    readonly ports: FastPorts
    readonly log: string[]
    readonly memos: Map<string, string>
    readonly targets: PushTarget[]
    readonly forwarded: (readonly string[])[]
}

const world = (options: { readonly key?: string | undefined; readonly depsOff?: boolean; readonly deps?: () => readonly string[]; readonly hfsExit?: number } = {}): World => {
    const log: string[] = []
    const memos = new Map<string, string>()
    const targets: PushTarget[] = []
    const forwarded: (readonly string[])[] = []
    const ports: FastPorts = {
        memoKey: () => ("key" in options ? options.key : "tree-1"),
        readMemo: (key) => memos.get(key),
        writeMemo: (key, text) => {
            memos.set(key, text)
        },
        depsOff: () => options.depsOff === true,
        deps: (target) => {
            targets.push(target)
            return Promise.resolve(options.deps?.() ?? [])
        },
        hfs: (args): Promise<VerbResult<unknown>> => {
            forwarded.push(args)
            log.push("hfs")
            return Promise.resolve({ data: { findings: [] }, message: "", exitCode: options.hfsExit ?? 0 })
        },
        say: (text) => log.push(text),
        json: true,
    }
    return { ports, log, memos, targets, forwarded }
}

void test("one check pass per push: a green fast run on a clean tree is remembered, and the hook's run on the same tree does not judge it again", async () => {
    const w = world()
    const args = ["--env", "prod", "--level", "dev", "--push-refs", line("refs/heads/dev")]
    const first = await runFastCheck(args, w.ports)
    assert.equal(first.exitCode, 0)
    assert.deepEqual(w.forwarded, [["--env", "prod", "--level", "dev"]], "--push-refs is the CLI's: @starci/hfs never sees it")
    assert.deepEqual(w.targets.map((target) => target.refs), [["refs/heads/dev"]], "the deps check is judged for the pushed refs (dev: local pins allowed)")
    assert.equal(w.memos.size, 1)
    const second = await runFastCheck(args, w.ports)
    assert.equal(second.exitCode, 0)
    assert.equal(w.forwarded.length, 1, "the second pass ran nothing")
    assert.equal(w.targets.length, 1)
    assert.match(w.log.at(-1) ?? "", /already passed the fast level .*one check pass per push/)
    assert.deepEqual((second.data as { findings: unknown[] }).findings, [], "a memo answer is a green report the gate reads")
})

void test("a red run or a dirty tree is never remembered", async () => {
    const red = world({ hfsExit: 1 })
    assert.equal((await runFastCheck(["--level", "dev"], red.ports)).exitCode, 1)
    assert.equal(red.memos.size, 0)
    const dirty = world({ key: undefined })
    await runFastCheck(["--level", "dev"], dirty.ports)
    await runFastCheck(["--level", "dev"], dirty.ports)
    assert.equal(dirty.forwarded.length, 2, "uncommitted work: every run judges")
    assert.equal(dirty.memos.size, 0)
})

void test("the deps check is part of the fast level: a refusal is a finding on package.json and @starci/hfs does not run; a declared-off deps gate is said and skipped", async () => {
    const refused = world({
        deps: () => {
            throw new Refusal("DEPS_PIN_UNPUBLISHED", "CI cannot install these committed @starci pins")
        },
    })
    const run = await runFastCheck(["--level", "dev"], refused.ports)
    assert.equal(run.exitCode, 1)
    assert.deepEqual((run.data as { findings: { code: string; path: string }[] }).findings.map((finding) => [finding.code, finding.path]), [["DEPS_PIN_UNPUBLISHED", "package.json"]])
    assert.equal(refused.forwarded.length, 0)
    const off = world({ depsOff: true })
    assert.equal((await runFastCheck(["--level", "dev"], off.ports)).exitCode, 0)
    assert.equal(off.targets.length, 0)
    assert.ok(off.log.some((text) => text.startsWith("deps: off by declaration")))
    const noted = world({ deps: () => ["dev-local: refs/heads/dev accepts DEPS_PIN_UNPUBLISHED"] })
    const accepted = await runFastCheck(["--level", "dev"], noted.ports)
    assert.deepEqual((accepted.data as { deps?: { notes: string[] } }).deps?.notes, ["dev-local: refs/heads/dev accepts DEPS_PIN_UNPUBLISHED"])
    assert.equal(pushRefsOf(["--push-refs=abc"]), "abc")
})

const pushPorts = (): { ports: PushPorts; log: string[] } => {
    const log: string[] = []
    return {
        log,
        ports: {
            git: () => ({ exitCode: 0, stdout: "" }),
            check: () => {
                log.push("check")
                return { exitCode: 0, stdout: JSON.stringify({ findings: [] }) }
            },
            push: (args) => {
                log.push(`push ${args.join(" ")}`)
                return { exitCode: 0, stdout: "" }
            },
            say: () => undefined,
        },
    }
}

void test("app push of a landing on dev runs no check of its own (its hook runs the fast level once); any other push runs the full check first", () => {
    const dev = pushPorts()
    const landed = warmAndPush(dev.ports, ["origin", "HEAD:dev"], "dev")
    assert.equal(landed.pushed, true)
    assert.equal(landed.runs, 0)
    assert.deepEqual(dev.log, ["push origin HEAD:dev"])
    const main = pushPorts()
    const promoted = warmAndPush(main.ports, ["origin", "main"], "full")
    assert.equal(promoted.runs, 1)
    assert.deepEqual(main.log, ["check", "push origin main"])
})

void test("a standing hotfix pass skips the fast level for its one push: no deps check, no hfs, no memo", async () => {
    const w = world()
    const covered: FastPorts = { ...w.ports, hotfix: (refs) => (refs === undefined ? undefined : "hotfix: abc is the one commit of the running starci hotfix land") }
    const run = await runFastCheck(["--env", "prod", "--level", "dev", "--push-refs", line("refs/heads/dev")], covered)
    assert.equal(run.exitCode, 0)
    assert.equal(w.forwarded.length, 0)
    assert.equal(w.targets.length, 0)
    assert.equal(w.memos.size, 0)
    assert.match(w.log.at(-1) ?? "", /^hotfix: abc/u)
    const open = await runFastCheck(["--env", "prod", "--level", "dev"], covered)
    assert.equal(w.forwarded.length, 1, "a run with no push refs is judged as before")
    assert.equal(open.exitCode, 0)
})
