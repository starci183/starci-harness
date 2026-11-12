/**
 * The front-end lint of an app's root workspace packages: the managed root `eslint.config.mjs` calls
 * `starciFePackagesConfig({ hfs: loadPackagesHfs(import.meta.url) })` beside the Grammar family's `...PackagesConfig`. No config of a side reaches
 * `packages/`, so the workbench of a module package was never linted; this config gives its `src/workbench/**` and `src/public/**` the rules of the
 * front end over the package view of the app root (the workbench contract is React-free and stays with the back-end canon).
 */
import assert from "node:assert/strict"
import test from "node:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { Linter } from "eslint"
import { starciFePackagesConfig, recommended } from "./index.ts"
import { PACKAGE_IGNORED, PACKAGE_SOURCE_FILES, PACKAGE_SPEC_FILES, TEST_SCOPE_BLOCK } from "./lib/config.ts"
import { packagesHfsFromDeclaration } from "./lib/hfs.ts"

const TSCONFIG = JSON.stringify({
  compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true, skipLibCheck: true, jsx: "preserve" },
  include: ["src"]
})

const DECLARATION = { hfs: 3, kind: "app", project: "fixture", sides: { be: { apps: [{ name: "core", kind: "api" }] }, fe: { grammar: "core", apps: [{ name: "web", kind: "next" }] } } }

/** An app root with a root package `@fixture/sdk`, its `files` written, and the package view of it. */
const appWith = (files: Readonly<Record<string, string>>, starci?: unknown) => {
  const root = mkdtempSync(join(tmpdir(), "starci-fe-packages-"))
  const write = (relative: string, text: string) => {
    mkdirSync(dirname(join(root, relative)), { recursive: true })
    writeFileSync(join(root, relative), text)
  }
  write("package.json", JSON.stringify({ name: "fixture", private: true, workspaces: ["packages/*"] }))
  write("packages/sdk/package.json", JSON.stringify({ name: "@fixture/sdk", version: "0.1.0", private: true, ...(starci === undefined ? {} : { starci }) }))
  write("packages/sdk/tsconfig.json", TSCONFIG)
  write("packages/sdk/src/index.ts", "export const sdk: number = 1\n")
  for (const [relative, text] of Object.entries(files)) write(`packages/sdk/${relative}`, text)
  return { root, hfs: packagesHfsFromDeclaration(DECLARATION, root), cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

const lint = (root: string, hfs: ReturnType<typeof packagesHfsFromDeclaration>, file: string, text: string) =>
  new Linter({ cwd: root, configType: "flat" }).verify(text, starciFePackagesConfig({ hfs }), { filename: join(root, file) })

test("the config narrows the files to the front-end subpaths of the packages and leaves the workbench contract to the back end", () => {
  const app = appWith({})
  try {
    const config = starciFePackagesConfig({ hfs: app.hfs })
    assert.deepEqual(config[0], { ignores: [...PACKAGE_IGNORED] })
    const scoped = config.slice(1)
    assert.ok(scoped.length >= 2, "the rule block and the Sonar way block")
    for (const block of scoped) {
      assert.deepEqual(block.files, [...(block.name === TEST_SCOPE_BLOCK ? PACKAGE_SPEC_FILES : PACKAGE_SOURCE_FILES)])
      assert.ok((block.ignores ?? []).includes("packages/*/src/workbench/contract/**"))
    }
    assert.deepEqual(PACKAGE_SOURCE_FILES, ["packages/*/src/workbench/**/*.{ts,tsx}", "packages/*/src/public/**/*.{ts,tsx}", "packages/*/src/**/*.tsx"])
    const rules = scoped.find((block) => block.rules !== undefined && "starci-fe/explicit-export-surface" in block.rules)?.rules ?? {}
    assert.equal(rules["starci-fe/explicit-export-surface"], "error")
    assert.equal("starci-fe/duplicate-code" in rules, false, "the project-graph rules judge the side folders, not the packages")
    assert.ok(Object.keys(recommended).filter((name) => name in rules).length > 100, "the rest of the canon is on")
  } finally { app.cleanup() }
})

test("a workbench file of a package is linted by the front-end rules: the explicit surface (R368) judges it", () => {
  const text = "export const total = (value: number) => value + 1\n"
  const app = appWith({ "src/workbench/total.ts": text })
  try {
    const found = lint(app.root, app.hfs, "packages/sdk/src/workbench/total.ts", text).map((message) => message.ruleId)
    assert.ok(found.includes("starci-fe/explicit-export-surface"), found.join(", "))
  } finally { app.cleanup() }
})

test("the back-end subpaths of a package and its workbench contract are not the front-end canon's", () => {
  const text = "/** The next value. */\nexport const total = (value: number): number => value + 1\n"
  const app = appWith({ "src/node/index.ts": text, "src/workbench/contract/index.ts": text, "src/public/page.ts": text })
  try {
    for (const back of ["src/node/index.ts", "src/workbench/contract/index.ts"]) {
      const messages = lint(app.root, app.hfs, `packages/sdk/${back}`, text)
      assert.match(messages.map((message) => message.message).join("\n"), /No matching configuration/, `${back} is for the back-end canon`)
    }
    const owned = lint(app.root, app.hfs, "packages/sdk/src/public/page.ts", text)
    assert.deepEqual(owned.map((message) => `${message.ruleId}: ${message.message}`), [], "a clean public file passes")
  } finally { app.cleanup() }
})

test("a package view is the fe profile over the paths of the app root and carries the Grammar of the app", () => {
  const app = appWith({})
  try {
    assert.equal(app.hfs.profile, "fe")
    assert.equal(app.hfs.grammar, "core")
    assert.equal(app.hfs.tierOf("packages/sdk/src/workbench/index.ts"), "package")
    assert.equal(app.hfs.slotOf("packages/sdk/src/workbench/index.ts"), "app.packages")
    assert.equal(app.hfs.slotOf("packages/ui-kit/src/workbench/index.ts"), "app.packages", "a block library is a root package by any name")
    assert.equal(app.hfs.tierOf("packages/ui-kit/src/public/page.ts"), "package")
    assert.equal(app.hfs.tierOf("fe/apps/web/src/app/page.tsx"), null)
  } finally { app.cleanup() }
})

test("a package's workbench declares the one result union its manifest names (starci.outcome); an ad-hoc union beside it is refused (R51)", () => {
  const union = (name: string) => `/** A result. */\nexport type ${name} = { readonly ok: true; readonly value: string } | { readonly ok: false; readonly reason: string }\n`
  const declared = `${union("AgentResult")}${union("StepResult")}`
  const elsewhere = union("AgentResult")
  const app = appWith({ "src/workbench/outcome.ts": declared, "src/workbench/view.ts": elsewhere }, { outcome: { name: "AgentResult", file: "src/workbench/outcome.ts" } })
  const bare = appWith({ "src/workbench/outcome.ts": elsewhere })
  try {
    const unions = (root: string, hfs: ReturnType<typeof packagesHfsFromDeclaration>, file: string, text: string) =>
      lint(root, hfs, file, text).filter((message) => message.ruleId === "starci-fe/one-outcome-union").map((message) => message.message.split("`")[1])
    assert.deepEqual(unions(app.root, app.hfs, "packages/sdk/src/workbench/outcome.ts", declared), ["StepResult"], "the declared name in the declared file passes, a second union there does not")
    assert.deepEqual(unions(app.root, app.hfs, "packages/sdk/src/workbench/view.ts", elsewhere), ["AgentResult"], "the declared name in another file is a second union")
    assert.deepEqual(unions(bare.root, bare.hfs, "packages/sdk/src/workbench/outcome.ts", elsewhere), ["AgentResult"], "without a declaration a package has no outcome home")
  } finally {
    app.cleanup()
    bare.cleanup()
  }
})

test("a .tsx file of a package outside workbench and public (src/client/) is linted by the front-end rules, a plain .ts file there is not", () => {
  const view = "export const total = (value: number) => value + 1\n"
  const tsx = "export const Total = (value: number) => <span>{value}</span>\n"
  const app = appWith({ "src/client/Badge.tsx": tsx, "src/client/helper.ts": view, "src/client/deep/inner/Card.tsx": tsx })
  try {
    for (const file of ["src/client/Badge.tsx", "src/client/deep/inner/Card.tsx"]) {
      const messages = lint(app.root, app.hfs, `packages/sdk/${file}`, tsx)
      assert.doesNotMatch(messages.map((message) => message.message).join(", "), /No matching configuration/, `${file} is ignored`)
      assert.ok(messages.some((message) => message.ruleId?.startsWith("starci-fe/")), `${file}: ${messages.map((message) => message.ruleId).join(", ")}`)
    }
    const plain = lint(app.root, app.hfs, "packages/sdk/src/client/helper.ts", view)
    assert.match(plain.map((message) => message.message).join(", "), /No matching configuration/, "a .ts file there is the back-end canon's")
  } finally { app.cleanup() }
})
