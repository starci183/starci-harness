/**
 * The proof that `crossFileInputs` is complete (contexts/project/check-cache.md, ESLint and stylelint, kind 3).
 *
 * Static: every source file of this canon that reads the disk is named by a declaration or accounted for below. Dynamic: each reader runs under
 * the file-system recorder of the shared fixtures (../../eslint-canon-be/fixtures/fs-audit.ts) and every read it makes below the repository must
 * be covered by a declaration; with the declarations taken away the same reads are reported, so the check can fail.
 */
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import test from "node:test"
import type { TestContext } from "node:test"
import { recordFsReads, recordFsReadsAsync, uncoveredReads } from "../../eslint-canon-be/fixtures/fs-audit.ts"
import { crossFileInputs } from "./lib/cross-file-inputs.ts"
import { loadAppTokens, ruleNames } from "./index.ts"
import { lintRule } from "./testing.ts"

const SRC = import.meta.dirname
const PACKAGE_ROOT = resolve(SRC, "..")

/** Source files that name the disk but read nothing when a stylesheet is linted, and why. */
const ACCOUNTED: Readonly<Record<string, string>> = {
  "lib/extract-values.ts": "generation-time script: reads @starci/grammar's source to write the committed vocabulary; the linter reads the committed result",
  "lib/extract-vocabulary.ts": "generation-time script: reads @starci/grammar's source to write the committed vocabulary; the linter reads the committed result",
  "lib/write-vocabulary.ts": "generation-time script: writes the committed vocabulary",
}

const READS_DISK = /from\s+["'](?:node:)?fs(?:\/promises)?["']|\bts\.sys\b/

const sourceFiles = (folder = SRC): string[] =>
  readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const file = join(folder, entry.name)
    if (entry.isDirectory()) return sourceFiles(file)
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts") ? [relative(SRC, file).replaceAll("\\", "/")] : []
  })

test("every source file that reads the disk is declared or accounted for", () => {
  const readers = new Set(crossFileInputs.map((input) => input.reader))
  const reading = sourceFiles().filter((file) => READS_DISK.test(readFileSync(join(SRC, file), "utf8")))
  const unaccounted = reading.filter((file) => !readers.has(file) && !(file in ACCOUNTED))
  assert.deepEqual(unaccounted, [], "declare these in src/cross-file-inputs.ts, or account for them in ACCOUNTED with the reason they need no declaration")
  for (const file of [...readers, ...Object.keys(ACCOUNTED)]) assert.ok(reading.includes(file), `${file} no longer reads the disk: drop its declaration`)
})

test("every declaration names a rule of the canon, a real reader and well-formed globs", () => {
  for (const input of crossFileInputs) {
    assert.ok(ruleNames.includes(input.rule), `${input.rule} is no rule of this canon`)
    assert.ok(["content", "exists"].includes(input.kind) && ["file", "side"].includes(input.relativeTo))
    assert.ok(input.globs.length > 0 && input.appliesTo.length > 0, `${input.rule} declares no globs`)
    for (const glob of [...input.globs, ...input.appliesTo]) assert.ok(glob !== "" && !glob.includes("\\") && !glob.startsWith("/"), `${input.rule}: ${glob} is not a relative posix glob`)
    assert.ok(sourceFiles().includes(input.reader), `${input.rule}: reader ${input.reader} is no source file`)
  }
})

const repo = (t: TestContext, files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), "stylelint-audit-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(dir, file, ".."), { recursive: true })
    writeFileSync(join(dir, file), text)
  }
  return dir
}

const canon = { inputs: crossFileInputs, packageRoot: PACKAGE_ROOT }
const none = { inputs: [], packageRoot: PACKAGE_ROOT }

test("the app tokens the config allows are read only where token-only and no-apply-raw declare it", (t) => {
  const dir = repo(t, {
    "apps/web/src/app/globals.css": ":root { --page-ink: var(--grammar-ink); }\n",
    "apps/admin/src/app/globals.css": ":root { --admin-gap: var(--grammar-gap-2); }\n",
    "packages/kit/src/styles/globals.css": ":root { --kit-edge: var(--grammar-edge); }\n",
    "apps/web/node_modules/dep/globals.css": ":root { --not-read: 1; }\n",
  })
  const { value, reads } = recordFsReads(() => loadAppTokens(pathToFileURL(join(dir, "stylelint.config.mjs")).href))
  assert.deepEqual(value, ["--admin-gap", "--kit-edge", "--page-ink"])
  assert.ok(reads.some((read) => read.op === "read"), "the reader read the stylesheets")
  for (const rule of ["starci/token-only", "starci/no-apply-raw"]) {
    assert.deepEqual(uncoveredReads(canon, { rule, file: join(dir, "apps/web/src/app/card.css"), root: dir, text: "" }, reads), [], rule)
  }
  assert.ok(uncoveredReads(none, { rule: "starci/token-only", file: join(dir, "apps/web/src/app/card.css"), root: dir, text: "" }, reads).length > 0, "without the declaration the same reads are reported")
  // a rule that declares nothing may not read them
  assert.ok(uncoveredReads(canon, { rule: "starci/no-important", file: join(dir, "apps/web/src/app/card.css"), root: dir, text: "" }, reads).length > 0)
})

test("source-resolves asks only whether a path exists, below what its declaration covers", async (t) => {
  const dir = repo(t, { "src/app/globals.css": "", "src/components/Card.tsx": "" })
  mkdirSync(join(dir, "node_modules", "@starci", "grammar"), { recursive: true })
  const file = join(dir, "src", "app", "globals.css")
  const { reads } = await recordFsReadsAsync(() => lintRule("source-resolves", '@source "../components";\n@source "../missing/**/*.tsx";\n@source "../../node_modules/@starci/grammar";', file))
  const mine = reads.filter((read) => resolve(read.target).startsWith(dir))
  assert.ok(mine.some((read) => read.op === "exists"), "the rule asked whether a path exists")
  assert.deepEqual(uncoveredReads(canon, { rule: "starci/source-resolves", file, root: dir, text: "" }, mine), [])
  assert.ok(uncoveredReads(none, { rule: "starci/source-resolves", file, root: dir, text: "" }, mine).length > 0, "without the declaration the same reads are reported")
})
