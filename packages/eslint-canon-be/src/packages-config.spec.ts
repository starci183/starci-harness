/**
 * The back-end lint of an app's root workspace packages (`packages/<pkg>/src/**`): the managed root `eslint.config.mjs` calls
 * `starciBePackagesConfig({ hfs: loadPackagesHfs(import.meta.url) })`. No config of a side reaches `packages/`, so the code of a package was
 * never linted; this config gives it the rule set of the be side over the package view of the app root.
 */
import assert from "node:assert/strict"
import test from "node:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { TSESLint } from "@typescript-eslint/utils"
import { starciBePackagesConfig, recommended } from "./index.ts"
import { PACKAGE_IGNORED, PACKAGE_SOURCE_FILES } from "./lib/config.ts"
import { packagesHfsFromDeclaration } from "./lib/hfs.ts"
import { appDeclaration } from "../fixtures/app.ts"

const TSCONFIG = JSON.stringify({
    compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true, skipLibCheck: true, jsx: "preserve" },
    include: ["src"],
})

/** An app root with a root package `@fixture/agent-sdk`, its `files` written, and the package view of it. */
const appWith = (files: Readonly<Record<string, string>>, dependencies: Readonly<Record<string, string>> = {}) => {
    const root = mkdtempSync(join(tmpdir(), "starci-be-packages-"))
    const write = (relative: string, text: string) => {
        mkdirSync(dirname(join(root, relative)), { recursive: true })
        writeFileSync(join(root, relative), text)
    }
    write("package.json", JSON.stringify({ name: "fixture", private: true, workspaces: ["packages/*"], dependencies: { "@fixture/agent-sdk": "*", stripe: "1.0.0", ...dependencies } }))
    write("packages/agent-sdk/package.json", JSON.stringify({ name: "@fixture/agent-sdk", version: "0.1.0", private: true }))
    write("packages/agent-sdk/tsconfig.json", TSCONFIG)
    write("packages/agent-sdk/src/index.ts", "export const sdk: number = 1\n")
    for (const [relative, text] of Object.entries(files)) write(`packages/agent-sdk/${relative}`, text)
    const hfs = packagesHfsFromDeclaration(appDeclaration("be", { apps: [{ name: "core", kind: "api" }] }), root)
    return { root, hfs, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

/** The messages of linting the text of a package file at its place under the app root (typed: the package's own tsconfig finds it). */
const lint = async (root: string, hfs: ReturnType<typeof packagesHfsFromDeclaration>, file: string, text: string) => {
    const linter = new TSESLint.Linter({ cwd: root })
    return linter.verify(text, await starciBePackagesConfig({ hfs }), { filename: join(root, file) })
}

test("the config narrows the files to the package source, leaving the front-end subpaths and the build output out", async () => {
    const app = appWith({})
    try {
        const config = await starciBePackagesConfig({ hfs: app.hfs })
        assert.deepEqual(config[0], { ignores: [...PACKAGE_IGNORED] })
        const scoped = config.slice(1).filter((block) => block.files !== undefined)
        assert.ok(scoped.length >= 4, "the rule block and the Sonar way block, each over the source and over the workbench contract")
        for (const block of scoped) {
            const files = (block.files ?? []).map(String)
            assert.ok(files.every((glob) => glob.startsWith("packages/*/src/")), String(files))
        }
        const ruleBlocks = scoped.filter((block) => block.rules !== undefined && "starci-be/explicit-export-surface" in block.rules)
        assert.deepEqual(ruleBlocks.map((block) => block.files), [[...PACKAGE_SOURCE_FILES], ["packages/*/src/workbench/contract/**/*.{ts,mts,cts,js,mjs,cjs}"]])
        assert.ok((ruleBlocks[0]?.ignores ?? []).includes("packages/*/src/workbench/**"))
        assert.ok((ruleBlocks[0]?.ignores ?? []).includes("packages/*/src/public/**"))
        assert.equal(ruleBlocks[1]?.ignores, undefined)
        const graph = Object.keys(recommended).filter((name) => name.startsWith("starci-be/") && ruleBlocks[0]?.rules && !(name in ruleBlocks[0].rules))
        assert.ok(graph.length > 0 && graph.length < 10, `only the project-graph rules of a side folder stay off: ${graph.join(", ")}`)
        assert.ok(graph.every((name) => /duplicate-code|dead-exports|owner|import|cycle|graph|reach|dependency|surface|coupling|boundary|route|unused|clone/.test(name)), graph.join(", "))
    } finally { app.cleanup() }
})

test("the code of a package is linted by the be rules: the explicit surface (R368) and the third-party owner (R279) judge it", async () => {
    const text = [
        'import Stripe from "stripe"',
        'import { sdk } from "@fixture/agent-sdk"',
        "export const total = (value: number) => value + sdk",
        'export const client = new Stripe("key")',
        "",
    ].join("\n")
    const app = appWith({ "src/node/index.ts": text })
    try {
        const messages = await lint(app.root, app.hfs, "packages/agent-sdk/src/node/index.ts", text)
        const found = messages.map((message) => message.ruleId).sort()
        assert.ok(found.includes("starci-be/explicit-export-surface"), `R368 judges the package: ${found.join(", ")}`)
        assert.ok(found.includes("starci-be/third-party-import-owner"), `an SDK import in a package is refused, the app's own package is not: ${found.join(", ")}`)
        assert.equal(messages.filter((message) => message.ruleId === "starci-be/third-party-import-owner").length, 1, "only stripe, not @fixture/agent-sdk")
    } finally { app.cleanup() }
})

test("a clean package file passes, and the workbench contract is back end while the workbench and public subpaths are not", async () => {
    const clean = "export const total = (value: number): number => value + 1\n"
    const app = appWith({
        "src/node/index.ts": clean,
        "src/workbench/contract/index.ts": "export interface Contract { readonly id: string }\n",
        "src/workbench/index.ts": "export const View = 1\n",
        "src/public/index.ts": "export const Public = 1\n",
    })
    try {
        const render = (messages: readonly TSESLint.Linter.LintMessage[]) => messages.map((message) => `${message.ruleId}: ${message.message}`)
        assert.deepEqual(render(await lint(app.root, app.hfs, "packages/agent-sdk/src/node/index.ts", clean)), [])
        assert.deepEqual(render(await lint(app.root, app.hfs, "packages/agent-sdk/src/workbench/contract/index.ts", "export interface Contract { readonly id: string }\n")), [])
        for (const front of ["src/workbench/index.ts", "src/public/index.ts"]) {
            const messages = await lint(app.root, app.hfs, `packages/agent-sdk/${front}`, "export const View = 1\n")
            assert.match(render(messages).join("\n"), /No matching configuration/, `${front} is for the front-end canon`)
        }
    } finally { app.cleanup() }
})

test("a package view is the be profile over the paths of the app root, the package its own owner of the tier package", () => {
    const app = appWith({})
    try {
        assert.equal(app.hfs.profile, "be")
        assert.equal(app.hfs.slotOf(join(app.root, "packages/agent-sdk/src/index.ts")), "app.packages")
        assert.equal(app.hfs.tierOf("packages/agent-sdk/src/index.ts"), "package")
        assert.equal(app.hfs.ownerOf("packages/agent-sdk/src/node/index.ts"), "packages/agent-sdk")
        assert.equal(app.hfs.slotOf("packages/modules/src/index.ts"), "app.module-registry")
        assert.equal(app.hfs.tierOf("be/src/main.ts"), null)
        assert.ok(app.hfs.ruleParams?.infraOwners, "the infrastructure owners of the be side judge what a package imports")
    } finally { app.cleanup() }
})
