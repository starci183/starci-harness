/**
 * The SDK authoring lint profile (lib/nivoos-profile.ts): a package the project declares in `hfs.json` `sides.nivoos.packages` is the slot `app.nivoos-package`, whose
 * `lintProfile: nivoos` hands its source to the canon with the SDK's own needs allowed and the rest kept. The same file in a folder the project does not declare is
 * the back end's, whole. The profile is chosen by the slot, never by a comment in the file.
 */
import assert from "node:assert/strict"
import test from "node:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { TSESLint } from "@typescript-eslint/utils"
import { starciBePackagesConfig } from "./index.ts"
import { PACKAGE_SOURCE_FILES } from "./lib/config.ts"
import { packagesHfsFromDeclaration } from "./lib/hfs.ts"
import { NIVOOS_RELAXED, NIVOOS_SLOT, isNivoosEntry } from "./lib/nivoos-profile.ts"
import { appDeclaration } from "../fixtures/app.ts"

const TSCONFIG = JSON.stringify({
    compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true, skipLibCheck: true, allowImportingTsExtensions: true },
    include: ["src"],
})

/** The declaration of an app that declares the nivoos package `biz`; `packages/other` is a root package the project does not declare. */
const declaration = (nivoos: boolean) => {
    const base = appDeclaration("be", { apps: [{ name: "core", kind: "api" }] })
    return nivoos ? { ...base, sides: { ...base.sides, nivoos: { packages: [{ name: "biz" }] } } } : base
}

/** An app root with `packages/biz` and `packages/other`, both holding `files`, and the package view of the declaration. */
const appWith = (files: Readonly<Record<string, string>>, nivoos = true) => {
    const root = mkdtempSync(join(tmpdir(), "starci-be-nivoos-"))
    const write = (relative: string, text: string) => {
        mkdirSync(dirname(join(root, relative)), { recursive: true })
        writeFileSync(join(root, relative), text)
    }
    const decl = declaration(nivoos)
    write("hfs.json", JSON.stringify(decl))
    write("package.json", JSON.stringify({ name: "fixture", private: true, workspaces: ["packages/*"] }))
    for (const name of ["biz", "other"]) {
        write(`packages/${name}/package.json`, JSON.stringify({ name: `@fixture/${name}`, version: "0.1.0", private: true }))
        write(`packages/${name}/tsconfig.json`, TSCONFIG)
        write(`packages/${name}/src/index.ts`, "export {}\n")
        for (const [relative, text] of Object.entries(files)) write(`packages/${name}/${relative}`, text)
    }
    return { root, hfs: packagesHfsFromDeclaration(decl, root), cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

const lint = async (root: string, hfs: ReturnType<typeof packagesHfsFromDeclaration>, file: string, text: string) => {
    const linter = new TSESLint.Linter({ cwd: root })
    return (await linter.verify(text, await starciBePackagesConfig({ hfs }), { filename: join(root, file) })).map((message) => message.ruleId)
}

/** A cell as the SDK wants it: Vietnamese copy in the literals, members the SDK interface types, a documented class. */
const CELL = [
    "/** The cell that greets a customer. */",
    "export class Greet {",
    "    readonly key = \"biz.greet\"",
    "    readonly title = { vi: \"Chào khách\", en: \"Greet the customer\" }",
    "    run(input: string): string {",
    "        return `Xin chào ${input}`",
    "    }",
    "}",
    "",
    "/** How many greetings a run sends at most. */",
    "export const LIMIT = Math.max(1, 2)",
    "",
].join("\n")

test("a declared package is the slot app.nivoos-package and an undeclared folder stays app.packages", () => {
    const app = appWith({})
    try {
        assert.equal(app.hfs.slotOf("packages/biz/src/index.ts"), NIVOOS_SLOT)
        assert.equal(app.hfs.slot(NIVOOS_SLOT)?.lintProfile, "nivoos")
        assert.equal(app.hfs.slotOf("packages/other/src/index.ts"), "app.packages")
        assert.deepEqual(app.hfs.packageLint?.nivoos, ["packages/biz/src/**"])
    } finally { app.cleanup() }
    const none = appWith({}, false)
    try {
        assert.equal(none.hfs.slotOf("packages/biz/src/index.ts"), "app.packages")
        assert.deepEqual(none.hfs.packageLint?.nivoos, [])
    } finally { none.cleanup() }
})

test("the config judges a declared package by its own blocks: the canon less the relaxed rules, and the back-end blocks leave its source out", async () => {
    const app = appWith({})
    try {
        const config = await starciBePackagesConfig({ hfs: app.hfs })
        const ruleBlocks = config.filter((block) => block.rules !== undefined && "starci-be/explicit-export-surface" in block.rules || block.rules !== undefined && "starci-be/schema-bounded" in block.rules)
        const backEnd = ruleBlocks.find((block) => JSON.stringify(block.files) === JSON.stringify([...PACKAGE_SOURCE_FILES]))
        assert.ok(backEnd !== undefined && "starci-be/explicit-export-surface" in (backEnd.rules ?? {}), "the back end keeps the rule")
        assert.ok((backEnd.ignores ?? []).includes("packages/biz/src/**"), "and leaves the declared package out")
        const profiled = ruleBlocks.find((block) => JSON.stringify(block.files) === JSON.stringify([["packages/biz/src/**", "**/*.{ts,mts,cts,js,mjs,cjs}"]]))
        assert.ok(profiled !== undefined, "the declared package has its own rule block")
        for (const relaxed of Object.keys(NIVOOS_RELAXED)) assert.equal(relaxed in (profiled.rules ?? {}), false, `${relaxed} is relaxed`)
        for (const kept of ["starci-be/schema-bounded", "starci-be/require-export-jsdoc", "starci-be/no-inline-object-type", "starci-be/no-default-export"]) assert.equal((profiled.rules ?? {})[kept], "error", `${kept} is kept`)
        assert.equal("starci-be/no-non-ascii-source" in (profiled.rules ?? {}), false, "no-non-ascii-source is not applied to the package")
        for (const reason of Object.values(NIVOOS_RELAXED)) assert.ok(reason.length > 120, "each relaxation says why")
    } finally { app.cleanup() }
})

test("Vietnamese copy in a string or template literal and the default export of the package entry pass; the same file in an undeclared package is refused", async () => {
    const entry = ["/** The package. */", 'export default { package: { key: "biz", version: "1.0.0" } }', ""].join("\n")
    const helper = ["/** A helper. */", "export default 1", ""].join("\n")
    const app = appWith({ "src/greet.cell.ts": CELL, "src/biz.package.ts": entry, "src/helper.ts": helper })
    try {
        const found = await lint(app.root, app.hfs, "packages/biz/src/greet.cell.ts", CELL)
        assert.deepEqual(found, [], "the cell is clean under the profile")
        const refused = await lint(app.root, app.hfs, "packages/other/src/greet.cell.ts", CELL)
        assert.ok(refused.includes("starci-be/no-non-ascii-source"), `the back end refuses the copy: ${refused.join(", ")}`)
        assert.ok(refused.includes("starci-be/require-public-member-jsdoc"), refused.join(", "))
        assert.ok(refused.includes("starci-be/explicit-export-surface"), refused.join(", "))
        const entry = "/** The package. */\nexport default { package: { key: \"biz\", version: \"1.0.0\" } }\n"
        assert.deepEqual((await lint(app.root, app.hfs, "packages/biz/src/biz.package.ts", entry)).filter((id) => id === "starci-be/no-default-export"), [], "the SDK entry is loaded by its default export")
        assert.ok((await lint(app.root, app.hfs, "packages/other/src/biz.package.ts", entry)).includes("starci-be/no-default-export"))
        assert.ok((await lint(app.root, app.hfs, "packages/biz/src/helper.ts", "/** A helper. */\nexport default 1\n")).includes("starci-be/no-default-export"), "any other file of the package stays named-export only")
    } finally { app.cleanup() }
})

test("no-non-ascii-source is off for a declared package (Vietnamese in comments, literals and identifiers, emoji) and on for an undeclared one; an undocumented export is still refused", async () => {
    const identifier = ["/** Tên. */", "export const tên: number = 1", ""].join("\n")
    const comment = ["// Chào khách", "/** A name. */", "export const name: number = 1", ""].join("\n")
    const emoji = ["/** A name. */", 'export const name: string = "ok ✅"', ""].join("\n")
    const undocumented = "export class Plain {}\n"
    const app = appWith({ "src/identifier.ts": identifier, "src/comment.ts": comment, "src/emoji.ts": emoji, "src/plain.ts": undocumented })
    try {
        for (const [what, text] of [["identifier", identifier], ["comment", comment], ["emoji", emoji]] as const) {
            const found = await lint(app.root, app.hfs, `packages/biz/src/${what}.ts`, text)
            assert.equal(found.includes("starci-be/no-non-ascii-source"), false, `${what} passes in the declared package: ${found.join(", ")}`)
            const refused = await lint(app.root, app.hfs, `packages/other/src/${what}.ts`, text)
            assert.ok(refused.includes("starci-be/no-non-ascii-source"), `${what} is refused in an undeclared package: ${refused.join(", ")}`)
        }
        assert.ok((await lint(app.root, app.hfs, "packages/biz/src/plain.ts", undocumented)).includes("starci-be/require-export-jsdoc"))
    } finally { app.cleanup() }
})

test("the entry of a package is src/<name>.package.ts", () => {
    assert.equal(isNivoosEntry("D:/app/packages/biz/src/biz.package.ts"), true)
    assert.equal(isNivoosEntry("packages/biz/src/biz.package.ts"), true)
    assert.equal(isNivoosEntry("packages/biz/src/nested/biz.package.ts"), false)
    assert.equal(isNivoosEntry("packages/biz/src/index.ts"), false)
})
