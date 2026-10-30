// The gate of ci.yml's publish-packages job (CONTRIBUTING.md CONTRIB-20): which due packages publish now, and in what order.
// Reads PLAN (`release publish --json`), EVERY (`release affected --json` with no base: every package with its build order),
// JOBS (this run's jobs, one `{name, conclusion}` per line) and MATRIX (the plan's package matrix). A due package publishes when
// every `gate (repo)` job is green and the `package` job of each folder of its build order (itself and the siblings it needs)
// that the plan tested is green; a sibling the plan did not test is unchanged since a green base. Every other due package is
// held. Writes `publish` (folders, a dependency before its dependent), `build` (their build orders) and `held` to GITHUB_OUTPUT.
import { appendFileSync, readFileSync } from "node:fs"

interface PlanRow {
    action: string
    dir: string
    package: string
    version: string
}
interface EveryPackage {
    dir: string
    name: string
    build?: string[]
}
interface JobRow {
    name: string
    conclusion: string
}

const read = (variable: string): string => readFileSync(process.env[variable]!, "utf8")
// Parsed input boundary: the three JSON documents the job writes to files, trusted at the fields read below.
const rows = (JSON.parse(read("PLAN")) as { data: { rows: PlanRow[] } }).data.rows
const every = (JSON.parse(read("EVERY")) as { data: { packages: EveryPackage[] } }).data.packages
const jobs = read("JOBS").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as JobRow)
const tested = new Set((JSON.parse(process.env.MATRIX || '{"include":[]}') as { include: Array<{ package: string }> }).include.map((entry) => entry.package))

const repoGates = jobs.filter((job) => job.name.startsWith("gate (repo) "))
const gatesGreen = repoGates.length > 0 && repoGates.every((job) => job.conclusion === "success")
for (const job of repoGates) console.log(`${job.name}: ${job.conclusion}`)

const buildOf = (dir: string): string[] => every.find((pkg) => pkg.dir === dir)?.build ?? [dir]
const nameOf = (dir: string): string => every.find((pkg) => pkg.dir === dir)?.name ?? rows.find((row) => row.dir === dir)?.package ?? dir
/** A folder the plan tested whose package job did not pass (failed, cancelled, skipped or missing). */
const red = (dir: string): boolean => tested.has(dir) && jobs.find((job) => job.name === `package (${nameOf(dir)})`)?.conclusion !== "success"

const due = rows.filter((row) => row.action === "publish" && row.dir !== "cli")
const reasonOf = (row: PlanRow): string | undefined => {
    if (!gatesGreen) return "a gate (repo) job is not green"
    const failed = buildOf(row.dir).filter(red)
    return failed.length > 0 ? `not green: ${failed.map((dir) => `package (${nameOf(dir)})`).join(", ")}` : undefined
}
const held: string[] = []
const ready = new Set<string>()
for (const row of due) {
    const reason = reasonOf(row)
    if (reason === undefined) ready.add(row.dir)
    else {
        held.push(row.dir)
        console.log(`::warning::${row.package}@${row.version} is held: ${reason}`)
    }
}

const order: string[] = []
const build: string[] = []
for (const row of due.filter((candidate) => ready.has(candidate.dir))) {
    for (const dir of buildOf(row.dir)) {
        if (ready.has(dir) && !order.includes(dir)) order.push(dir)
        if (!build.includes(dir)) build.push(dir)
    }
}
for (const row of rows) console.log(`${row.package}@${row.version}: ${ready.has(row.dir) ? "publish" : held.includes(row.dir) ? "held" : row.action}`)
appendFileSync(process.env.GITHUB_OUTPUT!, `publish=${order.join(" ")}\nbuild=${build.join(" ")}\nheld=${held.join(" ")}\n`)
