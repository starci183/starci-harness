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

const DECLARATION = appDeclaration("be", { apps: [{ name: "core", kind: "api" }] })

/** An app root (hfs.json, the one package.json) with a root package `@fixture/agent-sdk`, its `files` written, and the package view of it. */
const appWith = (files: Readonly<Record<string, string>>, starci?: unknown) => {
    const root = mkdtempSync(join(tmpdir(), "starci-be-packages-"))
    const write = (relative: string, text: string) => {
        mkdirSync(dirname(join(root, relative)), { recursive: true })
        writeFileSync(join(root, relative), text)
    }
    write("hfs.json", JSON.stringify(DECLARATION))
    write("package.json", JSON.stringify({ name: "fixture", private: true, workspaces: ["packages/*"], dependencies: { "@fixture/agent-sdk": "*", stripe: "1.0.0" } }))
    write("packages/agent-sdk/package.json", JSON.stringify({ name: "@fixture/agent-sdk", version: "0.1.0", private: true, ...(starci === undefined ? {} : { starci }) }))
    write("packages/agent-sdk/tsconfig.json", TSCONFIG)
    write("packages/agent-sdk/src/index.ts", "export const sdk: number = 1\n")
    for (const [relative, text] of Object.entries(files)) write(`packages/agent-sdk/${relative}`, text)
    const hfs = packagesHfsFromDeclaration(DECLARATION, root)
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
        const rules = ruleBlocks[0]?.rules ?? {}
        for (const on of ["starci-be/explicit-export-surface", "starci-be/third-party-import-owner", "starci-be/infra-import-owner", "starci-be/throw-domain-error"]) assert.equal(rules[on], "error", on)
        for (const off of ["starci-be/duplicate-code", "starci-be/dead-exports", "starci-be/tier-direction"]) assert.equal(off in rules, false, `${off} judges the import graph of a side folder`)
        assert.ok(Object.keys(recommended).filter((name) => name in rules).length > 100, "the rest of the canon is on")
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
    const app = appWith({ "src/node/total.ts": text })
    try {
        const messages = await lint(app.root, app.hfs, "packages/agent-sdk/src/node/total.ts", text)
        const found = messages.map((message) => message.ruleId).sort()
        assert.ok(found.includes("starci-be/explicit-export-surface"), `R368 judges the package: ${found.join(", ")}`)
        assert.ok(found.includes("starci-be/third-party-import-owner"), `an SDK import in a package is refused, the app's own package is not: ${found.join(", ")}`)
        assert.equal(messages.filter((message) => message.ruleId === "starci-be/third-party-import-owner").length, 1, "only stripe, not @fixture/agent-sdk")
    } finally { app.cleanup() }
})

test("a clean package file passes, and the workbench contract is back end while the workbench and public subpaths are not", async () => {
    const clean = "/** The next value. */\nexport const total = (value: number): number => value + 1\n"
    const contract = "/** What a view needs. */\nexport interface Contract {\n    /** The identifier of the view. */\n    readonly id: string\n}\n"
    const app = appWith({
        "src/node/total.ts": clean,
        "src/workbench/contract/contract.ts": contract,
        "src/workbench/view.ts": "export const View = 1\n",
        "src/public/page.ts": "export const Public = 1\n",
    })
    try {
        const render = (messages: readonly TSESLint.Linter.LintMessage[]) => messages.map((message) => `${message.ruleId}: ${message.message}`)
        assert.deepEqual(render(await lint(app.root, app.hfs, "packages/agent-sdk/src/node/total.ts", clean)), [])
        assert.deepEqual(render(await lint(app.root, app.hfs, "packages/agent-sdk/src/workbench/contract/contract.ts", contract)), [])
        for (const front of ["src/workbench/view.ts", "src/public/page.ts"]) {
            const messages = await lint(app.root, app.hfs, `packages/agent-sdk/${front}`, "export const View = 1\n")
            assert.match(render(messages).join("\n"), /No matching configuration/, `${front} is for the front-end canon`)
        }
    } finally { app.cleanup() }
})

test("a package view is the be profile over the paths of the app root: the tier package, no owner of the module laws", () => {
    const app = appWith({})
    try {
        assert.equal(app.hfs.profile, "be")
        assert.equal(app.hfs.slotOf(join(app.root, "packages/agent-sdk/src/index.ts")), "app.packages")
        assert.equal(app.hfs.tierOf("packages/agent-sdk/src/index.ts"), "package")
        assert.equal(app.hfs.ownerOf("packages/agent-sdk/src/node/total.ts"), null, "a package's public surface is the exports of its manifest, not one index.ts at an owner root")
        assert.equal(app.hfs.slotOf("packages/modules/src/index.ts"), "app.module-registry")
        assert.equal(app.hfs.tierOf("be/src/main.ts"), null)
        assert.ok(app.hfs.ruleParams?.infraOwners, "the infrastructure owners of the be side judge what a package imports")
    } finally { app.cleanup() }
})


const ERROR_BASE = { errorBase: { name: "AgentSdkError", file: "src/errors.ts" } }
const BASE_TEXT = "/** The error every refusal of the SDK derives from. */\nexport class AgentSdkError extends Error {}\n"

/** The findings of the error rules (R38) on a package file. */
const errorFindings = async (root: string, hfs: ReturnType<typeof packagesHfsFromDeclaration>, file: string, text: string) =>
    (await lint(root, hfs, file, text)).filter((message) => ["starci-be/throw-domain-error", "starci-be/error-home"].includes(message.ruleId ?? "")).map((message) => message.ruleId)

test("a root package throws the error base its manifest declares (starci.errorBase), and a raw Error is still refused (R38)", async () => {
    const own = [
        'import { AgentSdkError } from "../errors"',
        "",
        "/** A refusal of the SDK. */",
        "export class StepRefused extends AgentSdkError {}",
        "",
        "/** Refuses a step. */",
        "export const refuse = (): never => {",
        '    throw new StepRefused("no")',
        "}",
        "",
    ].join("\n")
    const raw = '/** Refuses a step. */\nexport const refuse = (): never => {\n    throw new Error("no")\n}\n'
    const app = appWith({ "src/errors.ts": BASE_TEXT, "src/node/refuse.ts": own, "src/node/raw.ts": raw }, ERROR_BASE)
    try {
        assert.deepEqual(await errorFindings(app.root, app.hfs, "packages/agent-sdk/src/errors.ts", BASE_TEXT), [], "the declared base is its own host, like DomainError in platform/errors")
        assert.deepEqual(await errorFindings(app.root, app.hfs, "packages/agent-sdk/src/node/refuse.ts", own), [], "a subclass of the declared base is declared and thrown anywhere in the package")
        assert.deepEqual(await errorFindings(app.root, app.hfs, "packages/agent-sdk/src/node/raw.ts", raw), ["starci-be/throw-domain-error"])
    } finally { app.cleanup() }
})

test("without a declaration, or with the name declared in another file, the package's own Error class is refused (R38)", async () => {
    const bare = appWith({ "src/errors.ts": BASE_TEXT })
    const elsewhere = appWith({ "src/errors.ts": BASE_TEXT }, { errorBase: { name: "AgentSdkError", file: "src/other.ts" } })
    try {
        for (const app of [bare, elsewhere]) {
            assert.deepEqual(await errorFindings(app.root, app.hfs, "packages/agent-sdk/src/errors.ts", BASE_TEXT), ["starci-be/error-home"])
        }
    } finally {
        bare.cleanup()
        elsewhere.cleanup()
    }
})

test("a package declaration that is not { name, file } stops the lint instead of being guessed", () => {
    for (const starci of [true, { errorBase: { name: "Agent Sdk", file: "src/errors.ts" } }, { outcome: { name: "Result", file: "../outside.ts" } }, { errorBase: "AgentSdkError" }]) {
        const app = appWith({}, starci)
        try {
            assert.throws(() => app.hfs.packageContract?.(join(app.root, "packages/agent-sdk/src/index.ts")), /package\.json: "starci/u, JSON.stringify(starci))
        } finally { app.cleanup() }
    }
    const app = appWith({}, { outcome: { name: "AgentResult", file: "src/outcome.ts" } })
    try {
        assert.deepEqual(app.hfs.packageContract?.(join(app.root, "packages/agent-sdk/src/index.ts")), { outcome: { name: "AgentResult", file: "packages/agent-sdk/src/outcome.ts" } })
        assert.equal(app.hfs.packageContract?.(join(app.root, "be/src/main.ts")), null, "outside a package there is no contract")
        assert.deepEqual(app.hfs.packageContract?.(join(app.root, "packages/module-sales/src/index.ts")), {}, "a package folder without a manifest declares nothing")
    } finally { app.cleanup() }
})

/** The schema-place findings (R304) of a package file. */
const schemaFindings = async (root: string, hfs: ReturnType<typeof packagesHfsFromDeclaration>, file: string, text: string) =>
    (await lint(root, hfs, file, text)).filter((message) => message.ruleId === "starci-be/schema-place").map((message) => message.messageId)

test("a root package declares its node, block and vocabulary contracts in zod in any file; a dto/ folder and a mixed schema file stay refused (R304)", async () => {
    const node = [
        'import { z } from "zod"',
        "",
        "/** What the node reads. */",
        "export const input: z.ZodObject<{ id: z.ZodString }> = z.object({ id: z.string().max(64) })",
        "",
    ].join("\n")
    const core = 'import type { ZodType } from "zod"\n\n/** A node of the graph: its contract is a zod schema. */\nexport interface NodeContract {\n    /** What the node reads. */\n    readonly input: ZodType\n}\n'
    const dto = 'import { z } from "zod"\n\n/** A request body. */\nexport const body: z.ZodString = z.string().max(5)\n'
    const mixed = 'import { z } from "zod"\nimport { IsString } from "class-validator"\n\n/** A schema. */\nexport const id: z.ZodString = z.string().max(5)\n\n/** The validator. */\nexport const validator: typeof IsString = IsString\n'
    const files = {
        "src/nodes/order/ask-missing.node.ts": node,
        "src/node/node.types.ts": core,
        "src/blocks/card-grid.block.ts": node,
        "src/vocabulary/tools.ts": node,
        "src/transport/dto/body.ts": dto,
        "src/order/order.schema.ts": mixed,
    }
    const app = appWith(files)
    try {
        for (const [file, text] of Object.entries(files).filter(([file]) => !file.includes("/dto/") && !file.endsWith(".schema.ts"))) {
            assert.deepEqual(await schemaFindings(app.root, app.hfs, `packages/agent-sdk/${file}`, text), [], `${file} declares a package contract`)
        }
        assert.deepEqual(await schemaFindings(app.root, app.hfs, "packages/agent-sdk/src/transport/dto/body.ts", dto), ["door"], "a dto/ folder answers to class-validator in a package too")
        assert.deepEqual(await schemaFindings(app.root, app.hfs, "packages/agent-sdk/src/order/order.schema.ts", mixed), ["mixed"], "the two validation layers never share a schema file")
    } finally { app.cleanup() }
})
