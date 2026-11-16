// CONTRIB-20 guard: nothing publishes unless the whole ci run of the commit is green, the Sonar quality gate and the app job included
// (2026-11-17: a red Sonar let three packages out). publish.yml starts only on a successful ci run, and publish-gate.mts holds every
// package and the CLI when any job of the run it reads is not green.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const repo = fileURLToPath(new URL("../../../../", import.meta.url))

void test("publish.yml starts only when the ci run succeeded, never on a failed one", () => {
    const workflow = readFileSync(join(repo, ".github", "workflows", "publish.yml"), "utf8")
    assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/u)
    assert.doesNotMatch(workflow, /workflow_run\.conclusion == 'failure'/u, "a failed ci run must never start a publication")
})

const gate = (jobs: ReadonlyArray<{ readonly name: string; readonly conclusion: string }>): Record<string, string> => {
    const dir = mkdtempSync(join(tmpdir(), "publish-gate-"))
    try {
        const plan = { data: { rows: [{ action: "publish", dir: "packages/seed", package: "@starci/seed", version: "9.9.9" }] } }
        const every = { data: { packages: [{ dir: "packages/seed", name: "@starci/seed", build: ["packages/seed"] }] } }
        writeFileSync(join(dir, "plan.json"), JSON.stringify(plan))
        writeFileSync(join(dir, "every.json"), JSON.stringify(every))
        writeFileSync(join(dir, "jobs.jsonl"), jobs.map((job) => JSON.stringify(job)).join("\n"))
        writeFileSync(join(dir, "out"), "")
        const run = spawnSync(process.execPath, [join(repo, ".github", "scripts", "publish-gate.mts")], {
            env: { ...process.env, PLAN: join(dir, "plan.json"), EVERY: join(dir, "every.json"), JOBS: join(dir, "jobs.jsonl"), MATRIX: JSON.stringify({ include: [{ package: "packages/seed" }] }), GITHUB_OUTPUT: join(dir, "out") },
            encoding: "utf8",
        })
        assert.equal(run.status, 0, run.stderr)
        return Object.fromEntries(readFileSync(join(dir, "out"), "utf8").split("\n").filter((line) => line.includes("=")).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]))
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
}

const GREEN = [
    { name: "plan", conclusion: "success" },
    { name: "gate (repo) secret scan", conclusion: "success" },
    { name: "gate (harness) anatomy drift", conclusion: "success" },
    { name: "package (@starci/seed)", conclusion: "success" },
    { name: "harness", conclusion: "success" },
    { name: "app", conclusion: "success" },
    { name: "sonar", conclusion: "success" },
]

void test("publish-gate publishes a green run, and a red Sonar or app job holds every package and the CLI", () => {
    const green = gate(GREEN)
    assert.equal(green.publish, "packages/seed")
    assert.equal(green.cli, "true")
    for (const red of ["sonar", "app"]) {
        const out = gate(GREEN.map((job) => (job.name === red ? { ...job, conclusion: "failure" } : job)))
        assert.equal(out.publish, "", `${red} red: nothing publishes`)
        assert.equal(out.held, "packages/seed")
        assert.equal(out.cli, "false")
    }
})
