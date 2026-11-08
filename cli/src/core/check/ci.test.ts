// The verdict `starci check ci` and the require-ci gate read for a commit: the `ci` runs of the commit and the `publish` runs that publish it
// (publish.yml starts on workflow_run, so GitHub files its run under main's head and only its run-name, `publish <sha>`, names the commit).
// Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import test from "node:test"
import { publishRunsOf, readCi, verdictOf } from "./ci.js"
import type { GhRunner, WorkflowRun } from "./ci.js"

const SHA = "a".repeat(40)
const NEWER = "b".repeat(40)

const run = (name: string, status: string, conclusion: string, databaseId: number, displayTitle?: string): WorkflowRun => ({
    name,
    status,
    conclusion,
    url: `https://github.com/o/r/actions/runs/${String(databaseId)}`,
    databaseId,
    ...(displayTitle === undefined ? {} : { displayTitle }),
})
const done = (name: string, conclusion: string, databaseId: number, displayTitle?: string): WorkflowRun => run(name, "completed", conclusion, databaseId, displayTitle)

/** A gh double: the commit's runs for `--commit`, the publish workflow's runs for `--workflow`, or the failure to throw for it. */
const gh = (commit: readonly WorkflowRun[], publish: readonly WorkflowRun[] | Error): GhRunner => (args) => {
    if (args.includes("--workflow")) return publish instanceof Error ? Promise.reject(publish) : Promise.resolve({ stdout: JSON.stringify(publish) })
    assert.ok(args.includes("--commit") && args.includes(SHA))
    return Promise.resolve({ stdout: JSON.stringify(commit) })
}

void test("a publish run is found by the sha in its title, never by another sha or a prefix", () => {
    const runs = [done("publish", "success", 1, `publish ${SHA}`), done("publish", "success", 2, `publish ${NEWER}`), done("publish", "success", 3, `publish ${SHA.slice(0, 9)}`), done("publish", "success", 4)]
    assert.deepEqual(publishRunsOf(runs, SHA).map((entry) => entry.databaseId), [1])
})

void test("verdicts: nothing, running, green, red, and a cancelled run that is neither", () => {
    assert.equal(verdictOf([]), "none")
    assert.equal(verdictOf([done("ci", "success", 1), run("publish", "in_progress", "", 2)]), "pending")
    assert.equal(verdictOf([run("publish", "queued", "", 2)]), "pending")
    assert.equal(verdictOf([done("ci", "success", 1), done("publish", "skipped", 2)]), "green")
    assert.equal(verdictOf([done("ci", "failure", 1)]), "red")
    assert.equal(verdictOf([done("ci", "cancelled", 1)]), "cancelled")
    assert.equal(verdictOf([done("ci", "success", 1), done("publish", "cancelled", 2)]), "cancelled")
    assert.equal(verdictOf([done("ci", "cancelled", 1), done("publish", "failure", 2)]), "red")
})

void test("a superseded ci run is not green", async () => {
    const reading = await readCi("/repo", SHA, gh([done("ci", "cancelled", 1)], []))
    assert.equal(reading.verdict, "cancelled")
})

void test("ci green with no publish run yet (an app, or nothing to publish) is green", async () => {
    assert.equal((await readCi("/repo", SHA, gh([done("ci", "success", 1)], []))).verdict, "green")
})

void test("ci green and its publish running is pending", async () => {
    const reading = await readCi("/repo", SHA, gh([done("ci", "success", 1)], [run("publish", "in_progress", "", 2, `publish ${SHA}`)]))
    assert.equal(reading.verdict, "pending")
    assert.match(reading.detail, /publish\s+in_progress/u)
})

void test("ci green and its publish failed is red, and the publish run is shown", async () => {
    const reading = await readCi("/repo", SHA, gh([done("ci", "success", 1)], [done("publish", "failure", 2, `publish ${SHA}`)]))
    assert.equal(reading.verdict, "red")
    assert.deepEqual(reading.runs.map((entry) => entry.name), ["ci", "publish"])
})

void test("another commit's failed publish does not redden this commit", async () => {
    const reading = await readCi("/repo", SHA, gh([done("ci", "success", 1)], [done("publish", "failure", 2, `publish ${NEWER}`), done("publish", "success", 3, `publish ${SHA}`)]))
    assert.equal(reading.verdict, "green")
})

void test("a repository without publish.yml is judged on its commit's runs alone", async () => {
    const missing = new Error("could not find any workflows named publish.yml")
    assert.equal((await readCi("/repo", SHA, gh([done("ci", "success", 1)], missing))).verdict, "green")
})

void test("a publish listing that fails for another reason is unreadable, never green", async () => {
    const reading = await readCi("/repo", SHA, gh([done("ci", "success", 1)], new Error("connection reset")))
    assert.equal(reading.verdict, "unreadable")
})
