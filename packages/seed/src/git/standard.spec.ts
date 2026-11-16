import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, sep } from "node:path"
import { after, test } from "node:test"
import type { StoredEntry } from "../copies.ts"
import { blobEntry, recordEntry } from "../manifest.ts"
import type { Runner } from "./driver.ts"
import type { StandardContent } from "./standard.ts"
import { STANDARD_ENVIRONMENT, STANDARD_OUTPUTS, STANDARD_TAKEN_AT, renderStandard, runStandardAdapter } from "./standard.ts"

const root = mkdtempSync(join(tmpdir(), "seed-standard-spec-"))
after(() => {
    rmSync(root, { recursive: true, force: true })
})
let counter = 0
const fresh = (name: string): string => join(root, `${name}-${String((counter += 1))}`)

/** Every file under `dir` as repository-relative path -> bytes. */
function tree(dir: string): Map<string, string> {
    const out = new Map<string, string>()
    for (const name of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
        const full = join(dir, name)
        if (statSync(full).isFile()) out.set(relative(dir, full).split(sep).join("/"), readFileSync(full).toString("base64"))
    }
    return out
}

const image = new Uint8Array([137, 80, 78, 71, 1, 2, 3])
const entries: StoredEntry[] = [
    { store: "database", entry: recordEntry("articles", "welcome", { title: "Welcome", body: "Hello", images: ["welcome/cover.png"] }) },
    { store: "database", entry: recordEntry("articles", "about", { title: "About", body: "Us" }) },
    { store: "storage", entry: blobEntry("article-images", "welcome/cover.png", image, "image/png") },
]
const content = (items: readonly StoredEntry[]): StandardContent => ({ format: "shop-seed-standard@1", project: "shop", entries: items })

test("a render writes the standard layout through the git driver, plaintext, with the fixed takenAt and environment", async () => {
    const out = fresh("out")
    await renderStandard(content(entries), out)
    const files = [...tree(out).keys()].sort()
    assert.ok(files.includes("manifest.json"))
    assert.ok(files.some((file) => file.startsWith("data/database/articles/")))
    assert.ok(files.includes("index/storage/article-images.json"))
    assert.ok(files.some((file) => file.startsWith("blobs/storage/article-images/")))
    assert.ok(files.every((file) => STANDARD_OUTPUTS.some((output) => file === output || file.startsWith(`${output}/`))), "it writes nothing but the four outputs")
    const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")) as Record<string, unknown>
    assert.equal(manifest.purpose, "seed-standard")
    assert.equal(manifest.sealing, "none")
    assert.equal(manifest.takenAt, STANDARD_TAKEN_AT)
    assert.deepEqual(manifest.source, { project: "shop", environment: STANDARD_ENVIRONMENT })
})

test("the same content renders the same bytes, whatever order convert answered in", async () => {
    const first = fresh("first")
    const second = fresh("second")
    await renderStandard(content(entries), first)
    await renderStandard(content([...entries].reverse()), second)
    assert.deepEqual(tree(first), tree(second))
})

test("a render replaces the outputs it owns and leaves raw/, adapter/ and every other file alone", async () => {
    const out = fresh("replace")
    mkdirSync(join(out, "data", "database", "gone"), { recursive: true })
    writeFileSync(join(out, "data", "database", "gone", "all.json"), "{}\n")
    mkdirSync(join(out, "raw"), { recursive: true })
    writeFileSync(join(out, "raw", "welcome.md"), "# Welcome\n")
    writeFileSync(join(out, "README.md"), "kept\n")
    await renderStandard(content(entries.slice(0, 2)), out)
    assert.equal(existsSync(join(out, "data", "database", "gone")), false, "a stale shard is removed")
    assert.equal(existsSync(join(out, "blobs")), false, "an output the content does not have is absent")
    assert.equal(readFileSync(join(out, "raw", "welcome.md"), "utf8"), "# Welcome\n")
    assert.equal(readFileSync(join(out, "README.md"), "utf8"), "kept\n")
})

test("a format that is no standard's is refused, and the git runner and scratch parent are seams", async () => {
    await assert.rejects(renderStandard({ ...content(entries), format: "shop-seed-backup-prod@1" }, fresh("refused")), { code: "DATA_FORM_REFUSED" })
    const programs: string[] = []
    const run: Runner = (program, args, options) => {
        programs.push(program)
        const result = spawnSync(program, [...args], { cwd: options.cwd, input: options.input, env: { ...process.env, ...options.env } })
        return { status: result.status, stdout: result.stdout, stderr: result.stderr }
    }
    const scratch = fresh("scratch")
    mkdirSync(scratch)
    const out = fresh("seams")
    await renderStandard(content(entries), out, { run, scratch })
    assert.ok(programs.includes("git"))
    assert.deepEqual(readdirSync(scratch), [], "the scratch working copy is removed")
})

test("runStandardAdapter is an adapter's main: raw and the repository root by default, usage 2, a failure 1 with its code or error", async () => {
    const cwd = fresh("repo")
    mkdirSync(join(cwd, "raw"), { recursive: true })
    const seen: string[] = []
    const lines: string[] = []
    const print = (line: string): void => void lines.push(line)
    assert.equal(await runStandardAdapter((rawDir) => (seen.push(rawDir), content(entries)), [], { cwd, print }), 0)
    assert.deepEqual(seen, [join(cwd, "raw")])
    assert.ok(existsSync(join(cwd, "manifest.json")))

    const out = fresh("absolute")
    assert.equal(await runStandardAdapter(() => content(entries), ["--raw", join(cwd, "raw"), "--out", out]), 0, "absolute paths need no cwd")
    assert.ok(existsSync(join(out, "manifest.json")))
    assert.equal(await runStandardAdapter(() => Promise.reject(new Error("printed on stderr")), ["--raw", join(cwd, "raw"), "--out", out]), 1, "with no io it prints on stderr")

    assert.equal(await runStandardAdapter(() => content(entries), ["--input", "x"], { cwd, print }), 2)
    assert.equal(await runStandardAdapter(() => content(entries), ["--raw"], { cwd, print }), 2)
    assert.equal(await runStandardAdapter(() => content(entries), ["--raw", "--out"], { cwd, print }), 2)
    assert.equal(await runStandardAdapter(() => ({ ...content(entries), format: "nope@1" }), [], { cwd, print }), 1)
    assert.equal(await runStandardAdapter(() => Promise.reject(new Error("raw/a.md has no title")), [], { cwd, print }), 1)
    assert.deepEqual(lines.slice(3), ["the adapter failed: DATA_FORM_REFUSED", "the adapter failed: Error: raw/a.md has no title"])
    assert.match(String(lines[0]), /^--input is no flag of an adapter run/u)
})
