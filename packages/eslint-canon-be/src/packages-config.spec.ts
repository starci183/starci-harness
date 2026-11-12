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

/** The declaration of the installed `@starci/common` the package files extend. */
const COMMON_TYPES = "export declare abstract class DomainError<C extends string> extends Error {\n    readonly code: C\n    constructor(init: { code: C; cause?: unknown })\n}\n"

const DECLARATION = appDeclaration("be", { apps: [{ name: "core", kind: "api" }] })

/** A project extension manifest that declares the slots of `packages/sdk`: views drawn by the front end, their React-free contract declared before them. */
const EXT = {
    schema: "starci/project-ext@1",
    api: 1,
    packages: {
        "packages/sdk": {
            closed: false,
            slots: [
                { id: "contract", path: "src/views/contract/**" },
                { id: "views", path: "src/views/**", lint: "fe", coverage: { none: "front-end views, proven by the front end's own gates" } },
                { id: "face", path: "src/face/**", lint: "fe", coverage: { none: "front-end pages, proven by the front end's own gates" } },
            ],
        },
    },
}

/** An app root (hfs.json, the one package.json) with a root package `@fixture/sdk`, its `files` written, and the package view of it. */
const appWith = (files: Readonly<Record<string, string>>, starci?: unknown, ext?: unknown) => {
    const root = mkdtempSync(join(tmpdir(), "starci-be-packages-"))
    const write = (relative: string, text: string) => {
        mkdirSync(dirname(join(root, relative)), { recursive: true })
        writeFileSync(join(root, relative), text)
    }
    write("hfs.json", JSON.stringify(DECLARATION))
    if (ext !== undefined) write("ext/manifest.json", JSON.stringify(ext))
    write("package.json", JSON.stringify({ name: "fixture", private: true, workspaces: ["packages/*"], dependencies: { "@fixture/sdk": "*", stripe: "1.0.0" } }))
    write("packages/sdk/package.json", JSON.stringify({ name: "@fixture/sdk", version: "0.1.0", private: true, ...(starci === undefined ? {} : { starci }) }))
    write("packages/sdk/tsconfig.json", TSCONFIG)
    write("packages/sdk/src/index.ts", "export const sdk: number = 1\n")
    write("node_modules/@starci/common/package.json", JSON.stringify({ name: "@starci/common", version: "1.0.0", types: "index.d.ts" }))
    write("node_modules/@starci/common/index.d.ts", COMMON_TYPES)
    for (const [relative, text] of Object.entries(files)) write(`packages/sdk/${relative}`, text)
    const hfs = packagesHfsFromDeclaration(DECLARATION, root)
    return { root, hfs, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

/** The messages of linting the text of a package file at its place under the app root (typed: the package's own tsconfig finds it). */
const lint = async (root: string, hfs: ReturnType<typeof packagesHfsFromDeclaration>, file: string, text: string) => {
    const linter = new TSESLint.Linter({ cwd: root })
    return linter.verify(text, await starciBePackagesConfig({ hfs }), { filename: join(root, file) })
}

test("the config narrows the files to the package source and knows no folder of a package: an undeclared package is back end whole", async () => {
    const app = appWith({})
    try {
        const config = await starciBePackagesConfig({ hfs: app.hfs })
        assert.deepEqual(config[0], { ignores: [...PACKAGE_IGNORED] })
        const scoped = config.slice(1).filter((block) => block.files !== undefined)
        assert.ok(scoped.length >= 2, "the rule block and the Sonar way block over the source")
        const ruleBlocks = scoped.filter((block) => block.rules !== undefined && "starci-be/explicit-export-surface" in block.rules)
        assert.deepEqual(ruleBlocks.map((block) => block.files), [[...PACKAGE_SOURCE_FILES]])
        // every .tsx file of a package source is the front-end canon's (FE-PACKAGES-2), never the back-end canon's
        assert.ok(PACKAGE_SOURCE_FILES.every((glob) => !glob.includes("tsx")))
        assert.deepEqual((ruleBlocks[0]?.ignores ?? []).filter((glob) => glob.startsWith("packages/")), [], "no front-end folder is assumed")
        const rules = ruleBlocks[0]?.rules ?? {}
        for (const on of ["starci-be/explicit-export-surface", "starci-be/third-party-import-owner", "starci-be/infra-import-owner", "starci-be/throw-domain-error"]) assert.equal(rules[on], "error", on)
        for (const off of ["starci-be/duplicate-code", "starci-be/dead-exports", "starci-be/tier-direction"]) assert.equal(off in rules, false, `${off} judges the import graph of a side folder`)
        assert.ok(Object.keys(recommended).filter((name) => name in rules).length > 100, "the rest of the canon is on")
    } finally { app.cleanup() }
})

test("the slots the project declares `lint: fe` are left to the front-end canon, and a back-end slot declared before one stays back end", async () => {
    const app = appWith({}, undefined, EXT)
    try {
        assert.deepEqual(app.hfs.packageLint, {
            frontEnd: ["packages/sdk/src/views/**", "packages/sdk/src/face/**"],
            fe: [{ files: "packages/sdk/src/views/**", ignores: ["packages/sdk/src/views/contract/**"] }, { files: "packages/sdk/src/face/**", ignores: ["packages/sdk/src/views/contract/**"] }],
            be: [{ files: "packages/sdk/src/views/contract/**", ignores: [] }],
        })
        const config = await starciBePackagesConfig({ hfs: app.hfs })
        const ruleBlocks = config.filter((block) => block.rules !== undefined && "starci-be/explicit-export-surface" in block.rules)
        assert.deepEqual(ruleBlocks.map((block) => block.files), [[...PACKAGE_SOURCE_FILES], [["packages/sdk/src/views/contract/**", "**/*.{ts,mts,cts,js,mjs,cjs}"]]])
        assert.deepEqual((ruleBlocks[0]?.ignores ?? []).filter((glob) => glob.startsWith("packages/")), ["packages/sdk/src/views/**", "packages/sdk/src/face/**"])
    } finally { app.cleanup() }
})

test("the code of a package is linted by the be rules: the explicit surface (R368) and the third-party owner (R279) judge it", async () => {
    const text = [
        'import Stripe from "stripe"',
        'import { sdk } from "@fixture/sdk"',
        "export const total = (value: number) => value + sdk",
        'export const client = new Stripe("key")',
        "",
    ].join("\n")
    const app = appWith({ "src/node/total.ts": text })
    try {
        const messages = await lint(app.root, app.hfs, "packages/sdk/src/node/total.ts", text)
        const found = messages.map((message) => message.ruleId).sort()
        assert.ok(found.includes("starci-be/explicit-export-surface"), `R368 judges the package: ${found.join(", ")}`)
        assert.ok(found.includes("starci-be/third-party-import-owner"), `an SDK import in a package is refused, the app's own package is not: ${found.join(", ")}`)
        assert.equal(messages.filter((message) => message.ruleId === "starci-be/third-party-import-owner").length, 1, "only stripe, not @fixture/sdk")
    } finally { app.cleanup() }
})

test("a clean package file passes; a declared front-end slot is not the back end's, its contract declared before it is, and an undeclared folder is", async () => {
    const clean = "/** The next value. */\nexport const total = (value: number): number => value + 1\n"
    const contract = "/** What a view needs. */\nexport interface Contract {\n    /** The identifier of the view. */\n    readonly id: string\n}\n"
    const files = {
        "src/node/total.ts": clean,
        "src/views/contract/contract.ts": contract,
        "src/views/view.ts": "export const View = 1\n",
        "src/face/page.ts": "export const Face = 1\n",
    }
    const render = (messages: readonly TSESLint.Linter.LintMessage[]) => messages.map((message) => `${message.ruleId}: ${message.message}`)
    const app = appWith(files, undefined, EXT)
    try {
        assert.deepEqual(render(await lint(app.root, app.hfs, "packages/sdk/src/node/total.ts", clean)), [])
        assert.deepEqual(render(await lint(app.root, app.hfs, "packages/sdk/src/views/contract/contract.ts", contract)), [])
        for (const front of ["src/views/view.ts", "src/face/page.ts"]) {
            const messages = await lint(app.root, app.hfs, `packages/sdk/${front}`, "export const View = 1\n")
            assert.match(render(messages).join("\n"), /No matching configuration/, `${front} is for the front-end canon`)
        }
    } finally { app.cleanup() }
    // The same tree, undeclared: no folder name hands a file to the front end, so the back-end rules judge the view.
    const undeclared = appWith(files)
    try {
        const messages = render(await lint(undeclared.root, undeclared.hfs, "packages/sdk/src/views/view.ts", "export const view = (value: number) => value + 1\n"))
        assert.doesNotMatch(messages.join("\n"), /No matching configuration/)
        assert.ok(messages.some((message) => message.startsWith("starci-be/")), messages.join("\n"))
    } finally { undeclared.cleanup() }
})

test("a package view is the be profile over the paths of the app root: the tier package, no owner of the module laws", () => {
    const app = appWith({})
    try {
        assert.equal(app.hfs.profile, "be")
        assert.equal(app.hfs.slotOf(join(app.root, "packages/sdk/src/index.ts")), "app.packages")
        assert.equal(app.hfs.tierOf("packages/sdk/src/index.ts"), "package")
        assert.equal(app.hfs.ownerOf("packages/sdk/src/node/total.ts"), null, "a package's public surface is the exports of its manifest, not one index.ts at an owner root")
        assert.equal(app.hfs.slotOf("packages/modules/src/index.ts"), "app.packages")
        assert.equal(app.hfs.tierOf("be/src/main.ts"), null)
        assert.ok(app.hfs.ruleParams?.infraOwners, "the infrastructure owners of the be side judge what a package imports")
    } finally { app.cleanup() }
})


const BASE_TEXT = [
    'import { DomainError } from "@starci/common"',
    "",
    "/** The codes of the SDK. */",
    'export type SdkCode = "SDK_REFUSED"',
    "",
    "/** The error every refusal of the SDK derives from. */",
    "export class SdkError extends DomainError<SdkCode> {}",
    "",
].join("\n")
const BARE_TEXT = "/** The error every refusal of the SDK derives from. */\nexport class SdkError extends Error {}\n"

/** The findings of the error rules (R38) on a package file. */
const errorFindings = async (root: string, hfs: ReturnType<typeof packagesHfsFromDeclaration>, file: string, text: string) =>
    (await lint(root, hfs, file, text)).filter((message) => ["starci-be/throw-domain-error", "starci-be/error-home"].includes(message.ruleId ?? "")).map((message) => message.ruleId)

test("a root package throws errors that derive from DomainError of @starci/common, and a raw Error is still refused (R38)", async () => {
    const own = [
        'import { SdkError } from "../errors"',
        "",
        "/** A refusal of the SDK. */",
        "export class StepRefused extends SdkError {}",
        "",
        "/** Refuses a step. */",
        "export const refuse = (): never => {",
        '    throw new StepRefused({ code: "SDK_REFUSED" })',
        "}",
        "",
    ].join("\n")
    const raw = '/** Refuses a step. */\nexport const refuse = (): never => {\n    throw new Error("no")\n}\n'
    const app = appWith({ "src/errors.ts": BASE_TEXT, "src/node/refuse.ts": own, "src/node/raw.ts": raw })
    try {
        assert.deepEqual(await errorFindings(app.root, app.hfs, "packages/sdk/src/errors.ts", BASE_TEXT), [], "a package error family is declared anywhere in the package")
        assert.deepEqual(await errorFindings(app.root, app.hfs, "packages/sdk/src/node/refuse.ts", own), [], "a subclass of the package error is declared and thrown anywhere in the package")
        assert.deepEqual(await errorFindings(app.root, app.hfs, "packages/sdk/src/node/raw.ts", raw), ["starci-be/throw-domain-error"])
    } finally { app.cleanup() }
})

test("a package's own bare Error class is refused, and errorBase is no declaration any more (R38)", async () => {
    const app = appWith({ "src/errors.ts": BARE_TEXT })
    try {
        assert.deepEqual(await errorFindings(app.root, app.hfs, "packages/sdk/src/errors.ts", BARE_TEXT), ["starci-be/error-home"])
    } finally { app.cleanup() }
})

test("a package declaration that is not { name, file } stops the lint instead of being guessed", () => {
    for (const starci of [true, { errorBase: { name: "SdkError", file: "src/errors.ts" } }, { outcome: { name: "Result", file: "../outside.ts" } }, { errorBase: "SdkError" }]) {
        const app = appWith({}, starci)
        try {
            assert.throws(() => app.hfs.packageContract?.(join(app.root, "packages/sdk/src/index.ts")), /package\.json: "starci/u, JSON.stringify(starci))
        } finally { app.cleanup() }
    }
    const app = appWith({}, { outcome: { name: "AgentResult", file: "src/outcome.ts" } })
    try {
        assert.deepEqual(app.hfs.packageContract?.(join(app.root, "packages/sdk/src/index.ts")), { outcome: { name: "AgentResult", file: "packages/sdk/src/outcome.ts" } })
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
            assert.deepEqual(await schemaFindings(app.root, app.hfs, `packages/sdk/${file}`, text), [], `${file} declares a package contract`)
        }
        assert.deepEqual(await schemaFindings(app.root, app.hfs, "packages/sdk/src/transport/dto/body.ts", dto), ["door"], "a dto/ folder answers to class-validator in a package too")
        assert.deepEqual(await schemaFindings(app.root, app.hfs, "packages/sdk/src/order/order.schema.ts", mixed), ["mixed"], "the two validation layers never share a schema file")
    } finally { app.cleanup() }
})
