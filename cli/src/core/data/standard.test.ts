// `starci data standard init` (PROJECT-STACKS-13, R434): a seed-standard copy repository is born with its guard, the commit hook and the CI
// workflow each running `starci app check --staged`, and with --adapter its raw/ and adapter/; it refuses a name that is no standard's and
// a code project, and keeps a file a person changed. Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import type { VerbContext } from "../../shared/verb.js"
import { SEED_PIN, STANDARD_GUARD, STANDARD_HOOK, STANDARD_WORKFLOW, dataStandardVerb, emptyManifest, initStandard } from "./standard.js"

const scratch = (name: string, then: (root: string) => void): void => {
    const parent = mkdtempSync(join(tmpdir(), "starci-standard-"))
    const root = join(parent, name)
    mkdirSync(root)
    try {
        then(root)
    } finally {
        rmSync(parent, { recursive: true, force: true })
    }
}

void test("init writes the guard of a standard and points the repository's hooks at it", () => {
    scratch("shop-seed-standard", (root) => {
        assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0)
        const data = initStandard(root, { adapter: false, force: false })
        assert.deepEqual(data.written, [".gitattributes", "manifest.json", STANDARD_HOOK, STANDARD_WORKFLOW])
        assert.equal(data.hooksPath, true)
        assert.equal(spawnSync("git", ["config", "--get", "core.hooksPath"], { cwd: root, encoding: "utf8" }).stdout.trim(), ".githooks")
        for (const file of [STANDARD_HOOK, STANDARD_WORKFLOW]) assert.ok(readFileSync(join(root, file), "utf8").includes(STANDARD_GUARD), `${file} runs the guard`)
        if (process.platform !== "win32") assert.equal(statSync(join(root, STANDARD_HOOK)).mode & 0o111, 0o111, "the hook is executable")
        const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as Record<string, unknown>
        assert.equal(manifest.format, "shop-seed-standard@1")
        assert.deepEqual(manifest.source, { project: "shop", environment: "standard" })
        assert.equal(manifest.exportDigest, "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", "sha256 of the canonical JSON of no set")
        assert.equal(readFileSync(join(root, ".gitattributes"), "utf8"), "* -text\n")
    })
})

void test("--adapter adds raw/ and an adapter/ whose package pins @starci/seed and the CLI", () => {
    scratch("shop-seed-standard", (root) => {
        const data = initStandard(root, { adapter: true, force: false })
        assert.equal(data.hooksPath, false, "no git repository yet")
        for (const file of ["raw/README.md", "adapter/main.ts", "adapter/convert.ts", "adapter/package.json", "adapter/tsconfig.json", "adapter/.gitignore"]) assert.ok(data.written.includes(file), file)
        const pkg = JSON.parse(readFileSync(join(root, "adapter/package.json"), "utf8")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> }
        assert.equal(pkg.dependencies["@starci/seed"], SEED_PIN)
        assert.ok(Object.keys(pkg.devDependencies).includes("starci-harness"))
        assert.match(readFileSync(join(root, "adapter/main.ts"), "utf8"), /runStandardAdapter\(convert, process\.argv\.slice\(2\)\)/u)
        assert.match(readFileSync(join(root, "adapter/convert.ts"), "utf8"), /const FORMAT = "shop-seed-standard@1"/u)
    })
})

void test("the adapter pins the @starci/seed of this harness", () => {
    const seed = JSON.parse(readFileSync(new URL("../../../../packages/seed/package.json", import.meta.url), "utf8")) as { version: string }
    assert.equal(SEED_PIN, seed.version)
})

void test("a file a person changed is kept unless --force; a name that is no standard's and a code project are refused", async () => {
    scratch("shop-seed-standard", (root) => {
        initStandard(root, { adapter: true, force: false })
        writeFileSync(join(root, "adapter/convert.ts"), "// mine\n")
        const again = initStandard(root, { adapter: true, force: false })
        assert.deepEqual(again.kept, ["adapter/convert.ts"])
        assert.equal(readFileSync(join(root, "adapter/convert.ts"), "utf8"), "// mine\n")
        assert.deepEqual(initStandard(root, { adapter: true, force: true }).kept, [])
        writeFileSync(join(root, "hfs.json"), "{}\n")
        assert.throws(() => initStandard(root, { adapter: false, force: false }), { code: "DATA_IN_CODE" })
    })
    scratch("shop-content", (root) => {
        assert.throws(() => initStandard(root, { adapter: false, force: false }), (error: Error & { code?: string }) => error.code === "DATA_COPY_NAME" && /--name <name>-seed-standard/u.test(error.message))
        assert.throws(() => initStandard(root, { adapter: false, force: false, name: "Shop_Content" }), { code: "DATA_COPY_NAME" }, "the given name is validated, not the folder")
        const renamed = initStandard(root, { adapter: true, force: false, name: "shop-seed-standard" })
        assert.equal(renamed.name, "shop-seed-standard", "a folder converted in place during its rename takes --name")
        assert.match(readFileSync(join(root, "manifest.json"), "utf8"), /"format": "shop-seed-standard@1"/u)
        assert.match(readFileSync(join(root, "adapter/convert.ts"), "utf8"), /shop-seed-standard@1/u)
    })
    assert.equal(emptyManifest("a-seed-standard", "a").endsWith("}\n"), true)
    // reason: the verb reads only cwd of its context.
    const context = { cwd: tmpdir() } as unknown as VerbContext
    await assert.rejects(dataStandardVerb.run(context, { action: "update", dir: undefined, adapter: false, force: false, name: undefined }), { code: "CLI_USAGE" })
    const parent = mkdtempSync(join(tmpdir(), "starci-standard-verb-"))
    try {
        const root = join(parent, "x-seed-standard")
        mkdirSync(root)
        const result = await dataStandardVerb.run(context, { action: "init", dir: root, adapter: true, force: false, name: undefined })
        assert.match(result.message, /^x-seed-standard: wrote 10 file\(s\); no git repository yet.*; next: npm install --prefix adapter/u)
    } finally {
        rmSync(parent, { recursive: true, force: true })
    }
})
