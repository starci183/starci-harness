/**
 * The Grammar lint of an app's root workspace packages: the managed root `eslint.config.mjs` spreads
 * `coreGrammarPackagesConfig({ hfs: loadPackagesHfs(import.meta.url) })` beside the front-end canon's package config, so the workbench of a module
 * package (`src/workbench/**`, `src/public/**`) is judged by the very family rules of a front end, over the package view of the app root.
 */
import assert from "node:assert/strict"
import test from "node:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { Linter } from "eslint"
import { packagesHfsFromDeclaration } from "../../eslint-canon-fe/src/lib/hfs.ts"
import type { HfsView } from "../../eslint-canon-fe/src/lib/hfs-view.ts"
import { PACKAGE_IGNORED, PACKAGE_SOURCE_FILES } from "../../eslint-canon-fe/src/lib/config.ts"
import { coreGrammarConfig, coreGrammarPackagesConfig, recommended } from "./index.ts"

const DECLARATION = { hfs: 3, kind: "app", project: "fixture", sides: { be: { apps: [{ name: "core", kind: "api" }] }, fe: { grammar: "core", apps: [{ name: "web", kind: "next" }] } } }

/** The package view as the family factory reads it: the fe profile of the selected family. */
const familyView = (hfs: HfsView) => {
  if (hfs.profile !== "fe" || hfs.grammar !== "core") throw new Error("the package view is not the fe view of the core family")
  return { ...hfs, profile: "fe" as const, grammar: "core" as const }
}

const appWith = (files: Readonly<Record<string, string>>) => {
  const root = mkdtempSync(join(tmpdir(), "starci-grammar-packages-"))
  const write = (relative: string, text: string) => {
    mkdirSync(dirname(join(root, relative)), { recursive: true })
    writeFileSync(join(root, relative), text)
  }
  write("package.json", JSON.stringify({ name: "fixture", private: true, workspaces: ["packages/*"] }))
  write("packages/agent-sdk/package.json", JSON.stringify({ name: "@fixture/agent-sdk", version: "0.1.0", private: true }))
  write("packages/agent-sdk/tsconfig.json", JSON.stringify({
    compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true, skipLibCheck: true, jsx: "preserve" },
    include: ["src"],
  }))
  for (const [relative, text] of Object.entries(files)) write(`packages/agent-sdk/${relative}`, text)
  return { root, hfs: familyView(packagesHfsFromDeclaration(DECLARATION, root)), cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test("the family config for packages is the family config narrowed to the front-end subpaths of the packages", () => {
  const app = appWith({})
  try {
    const whole = coreGrammarConfig({ hfs: app.hfs })
    const scoped = coreGrammarPackagesConfig({ hfs: app.hfs })
    assert.equal(scoped.length, whole.length)
    for (const block of scoped) {
      assert.deepEqual(block.files, [...PACKAGE_SOURCE_FILES])
      assert.ok((block.ignores ?? []).includes("packages/*/src/workbench/contract/**"))
      assert.deepEqual(block.rules, { ...recommended }, "every family rule is on, at error")
      assert.equal(block.settings?.["starci"] && typeof block.settings["starci"] === "object" && "hfs" in block.settings["starci"] ? block.settings["starci"].hfs : null, app.hfs)
    }
    assert.ok(PACKAGE_IGNORED.length > 0)
  } finally { app.cleanup() }
})

test("a view of another family is refused as the family config refuses it", () => {
  const app = appWith({})
  try {
    assert.throws(() => coreGrammarPackagesConfig({ hfs: app.hfs, family: "offset-pop" }), /does not match the selected Grammar core/)
  } finally { app.cleanup() }
})

test("a workbench file of a package is judged by the family rules: a Freestyle region without its reason is refused", () => {
  const text = [
    "/** A view that opens a Freestyle region. */",
    "export const View = (): React.ReactElement => <Freestyle>hand drawn</Freestyle>",
    "",
  ].join("\n")
  const app = appWith({ "src/workbench/View.tsx": text, "src/client/Panel.tsx": text, "src/node/index.ts": "export const node: number = 1\n" })
  try {
    const linter = new Linter({ cwd: app.root, configType: "flat" })
    const config = coreGrammarPackagesConfig({ hfs: app.hfs })
    const workbench = linter.verify(text, config, { filename: join(app.root, "packages/agent-sdk/src/workbench/View.tsx") })
    assert.ok(workbench.some((message) => message.ruleId === "starci-grammar/freestyle-has-reason"), workbench.map((message) => message.ruleId).join(", "))
    // a .tsx renderer outside workbench and public (src/client/) draws with the Grammar too (FE-PACKAGES-2)
    const client = linter.verify(text, config, { filename: join(app.root, "packages/agent-sdk/src/client/Panel.tsx") })
    assert.ok(client.some((message) => message.ruleId === "starci-grammar/freestyle-has-reason"), client.map((message) => message.ruleId ?? message.message).join(", "))
    const back = linter.verify("export const node: number = 1\n", config, { filename: join(app.root, "packages/agent-sdk/src/node/index.ts") })
    assert.match(back.map((message) => message.message).join("\n"), /No matching configuration/, "the back-end subpaths are not the family's")
  } finally { app.cleanup() }
})
