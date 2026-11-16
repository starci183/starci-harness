import { createHash } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { captureGitSync } from "../../shared/git.js"
import { BOTH_EDITIONS, WRITERS, defineVerb } from "../../shared/verb.js"
import { cliPackageName, packageVersion } from "../version.js"

/**
 * `starci data standard init [--adapter]`: makes the folder a seed-standard copy repository (contexts/project/stacks.md PROJECT-STACKS-13)
 * that cannot exist without its guard: `.gitattributes` (`* -text`, as the git driver of @starci/seed writes it), an empty plain
 * `manifest.json` (`starci/data-manifest@1`, exactly what the driver renders for no entry), the commit hook `.githooks/pre-commit` and the CI
 * workflow `.github/workflows/seed-standard.yml`, each running `starci app check --staged` (R400; R434), with `core.hooksPath` set to
 * `.githooks`. `--adapter` adds `raw/README.md` and an `adapter/` (package.json pinning @starci/seed, tsconfig.json, `main.ts` and a
 * `convert.ts` stub that turns `raw/*.md` into records), so authored material lives in raw/ and the committed layout is the adapter's output.
 * A file that exists is kept, never overwritten, and listed; `--force` rewrites the managed files.
 */

/** The @starci/seed an adapter pins: the version whose git entry exports `renderStandard` and `runStandardAdapter` (contexts/stack/pins.yaml). */
export const SEED_PIN = "0.2.0"
/** The commit hook and workflow paths R434 checks for, and the guard each runs. */
export const STANDARD_HOOK = ".githooks/pre-commit"
export const STANDARD_WORKFLOW = ".github/workflows/seed-standard.yml"
export const STANDARD_GUARD = "starci app check --staged"
/** The fixed `takenAt` and `source.environment` of a rendered standard (@starci/seed `STANDARD_TAKEN_AT`, `STANDARD_ENVIRONMENT`). */
const TAKEN_AT = "1970-01-01T00:00:00.000Z"
const ENVIRONMENT = "standard"
const NAME = /^[a-z0-9][a-z0-9-]*-seed-standard$/u

/** The manifest the git driver writes for a standard with no entry: the same keys in the same order, so the adapter's first run changes nothing. */
export const emptyManifest = (name: string, project: string): string =>
    `${JSON.stringify(
        {
            schema: "starci/data-manifest@1",
            format: `${name}@1`,
            purpose: "seed-standard",
            takenAt: TAKEN_AT,
            source: { project, environment: ENVIRONMENT },
            sets: [],
            exportDigest: createHash("sha256").update("[]").digest("hex"),
            sealing: "none",
            recipients: [],
            shards: {},
            files: {},
        },
        null,
        2,
    )}\n`

const HOOK = `#!/bin/sh
# The commit hook of a seed-standard copy repository, written by \`starci data standard init\`: the data guard of R400 and, with an
# adapter/, the drift check of R434 (the adapter re-run over raw/ as the index holds it). It fails closed: no starci, no commit.
if [ -x adapter/node_modules/.bin/starci ]; then
  exec adapter/node_modules/.bin/${STANDARD_GUARD}
fi
exec ${STANDARD_GUARD}
`

const workflow = (cli: string, version: string): string => `# The CI of a seed-standard copy repository, written by \`starci data standard init\`: the same guard as the commit hook (R400, R434),
# over the commit as pushed, so a commit made without the hook is judged too.
name: seed-standard
on:
  push:
  pull_request:
permissions:
  contents: read
jobs:
  guard:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: 24
      - name: Install the adapter
        if: hashFiles('adapter/package.json') != ''
        run: npm ci --prefix adapter --no-audit --no-fund
      - name: Judge the standard
        run: npx --yes --package ${cli}@${version} ${STANDARD_GUARD}
`

const RAW_README = `# raw

What people author for this standard: Markdown, YAML, code, images, in any layout the adapter reads. It is kept plain and never sealed (a
standard holds no secret); no file here exceeds 4 MiB, and raw/ counts toward the 500 MiB of the copy.

\`adapter/\` turns it into the committed standard: \`node adapter/main.ts\` from the repository root rewrites manifest.json, data/, blobs/
and index/. Never edit those by hand: the commit hook and CI re-run the adapter and refuse a commit whose output differs (R434).
`

const adapterPackage = (name: string, cli: string, version: string): string =>
    `${JSON.stringify(
        {
            name: `${name}-adapter`,
            version: "0.0.0",
            private: true,
            type: "module",
            description: `Converts raw/ into the ${name} layout through the git driver of @starci/seed.`,
            scripts: { convert: "node main.ts --raw ../raw --out ..", typecheck: "tsc -p ." },
            dependencies: { "@starci/seed": SEED_PIN },
            devDependencies: { "@types/node": "22.20.4", [cli]: version, typescript: "5.9.3" },
        },
        null,
        2,
    )}\n`

const ADAPTER_TSCONFIG = `${JSON.stringify(
    {
        compilerOptions: {
            target: "es2023",
            module: "nodenext",
            moduleResolution: "nodenext",
            strict: true,
            noEmit: true,
            allowImportingTsExtensions: true,
            erasableSyntaxOnly: true,
            verbatimModuleSyntax: true,
            skipLibCheck: true,
            types: ["node"],
        },
        include: ["*.ts"],
    },
    null,
    2,
)}\n`

const ADAPTER_MAIN = `// The adapter's entry (R434): \`node adapter/main.ts\` from the repository root converts raw/ and renders the standard layout through the
// git driver of @starci/seed. The commit hook and CI run it as \`node adapter/main.ts --raw <dir> --out <dir>\`.
import { runStandardAdapter } from "@starci/seed/git"
import { convert } from "./convert.ts"

process.exitCode = await runStandardAdapter(convert, process.argv.slice(2))
`

const adapterConvert = (name: string, project: string): string => `import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { recordEntry } from "@starci/seed"
import type { StoredEntry } from "@starci/seed"
import type { StandardContent } from "@starci/seed/git"

/** This repository's name and the format major. */
const FORMAT = "${name}@1"
/** The project the standard seeds. */
const PROJECT = "${project}"
/** The store the records load into: a store id of the app's data.stores. */
const STORE = "database"

/**
 * Reads raw/ and answers the standard's entries; it writes nothing. Deterministic: names sorted, no clock, no random id, so the same raw/
 * renders the same bytes. A stub: every raw/*.md but README.md is one record of the set \`pages\`, keyed by its file name.
 */
export function convert(rawDir: string): StandardContent {
    const pages = readdirSync(rawDir).filter((file) => file.endsWith(".md") && file !== "README.md").sort()
    const entries: StoredEntry[] = pages.map((file) => {
        const text = readFileSync(join(rawDir, file), "utf8")
        const title = /^# (.+)$/mu.exec(text)?.[1] ?? file.slice(0, -3)
        return { store: STORE, entry: recordEntry("pages", file.slice(0, -3), { title, body: text }) }
    })
    return { format: FORMAT, project: PROJECT, entries }
}
`

/** What one init wrote, kept and set. */
export interface StandardInitData {
    readonly root: string
    readonly name: string
    readonly adapter: boolean
    readonly written: readonly string[]
    readonly kept: readonly string[]
    readonly hooksPath: boolean
}

/** The managed files of a standard, by path: the base, and with `adapter` the raw/ and adapter/ stubs. */
export const standardFiles = (name: string, project: string, adapter: boolean, cli = cliPackageName(), version = packageVersion()): ReadonlyMap<string, string> =>
    new Map([
        [".gitattributes", "* -text\n"],
        ["manifest.json", emptyManifest(name, project)],
        [STANDARD_HOOK, HOOK],
        [STANDARD_WORKFLOW, workflow(cli, version)],
        ...(adapter
            ? ([
                  ["raw/README.md", RAW_README],
                  ["adapter/package.json", adapterPackage(name, cli, version)],
                  ["adapter/tsconfig.json", ADAPTER_TSCONFIG],
                  ["adapter/main.ts", ADAPTER_MAIN],
                  ["adapter/convert.ts", adapterConvert(name, project)],
                  ["adapter/.gitignore", "node_modules/\n"],
              ] as const)
            : []),
    ])

/** Writes the standard's files into `root` (an existing file kept unless `force`) and points the repository's hooks at `.githooks`. */
export function initStandard(root: string, options: { readonly adapter: boolean; readonly force: boolean; readonly name?: string | undefined }): StandardInitData {
    // `name` names the repository when the folder does not (a repository converted in place during its rename); it is validated, never the folder.
    const name = options.name ?? basename(root)
    if (!NAME.test(name)) throw new Refusal("DATA_COPY_NAME", `${name} is no seed-standard name: a standard's repository is <name>-seed-standard, lowercase kebab (PROJECT-STACKS-13)${options.name === undefined ? "; a folder named otherwise takes --name <name>-seed-standard" : ""}`)
    if (existsSync(join(root, "hfs.json"))) throw new Refusal("DATA_IN_CODE", `${root} holds hfs.json: a code project is never a copy repository (R400); init a standard in its own repository`)
    const project = name.slice(0, -"-seed-standard".length)
    const written: string[] = []
    const kept: string[] = []
    for (const [file, text] of standardFiles(name, project, options.adapter)) {
        const target = join(root, file)
        if (existsSync(target) && !options.force && readFileSync(target, "utf8") !== text) {
            kept.push(file)
            continue
        }
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, text)
        written.push(file)
    }
    chmodSync(join(root, STANDARD_HOOK), 0o755)
    const hooksPath = existsSync(join(root, ".git")) && captureGitSync(["config", "core.hooksPath", ".githooks"], root).exitCode === 0
    return { root, name, adapter: options.adapter, written, kept, hooksPath }
}

/** `starci data standard init`: scaffolds a seed-standard copy repository with its guard, and with `--adapter` its raw/ and adapter/. */
export const dataStandardVerb = defineVerb({
    path: ["data", "standard"],
    summary:
        "init a seed-standard copy repository (the folder, named <name>-seed-standard, or any folder with --name <name>-seed-standard): .gitattributes, an empty plain manifest.json, the commit hook .githooks/pre-commit (core.hooksPath set) and the CI workflow .github/workflows/seed-standard.yml, both running starci app check --staged (R400, R434); --adapter adds raw/README.md and an adapter/ (main.ts, a convert.ts stub, package.json pinning @starci/seed, tsconfig.json) whose output over raw/ the hook and CI compare byte for byte with the committed layout (HFS_DATA_ADAPTER_DRIFT); an existing file is kept unless --force",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/data-standard@1",
    flags: {
        action: { kind: "string", summary: "init", required: true, positional: true },
        dir: { kind: "string", summary: "the standard's repository folder (default: the working directory)" },
        adapter: { kind: "boolean", summary: "add raw/ and an adapter/ that converts it into the standard layout" },
        force: { kind: "boolean", summary: "rewrite the managed files that exist" },
        name: { kind: "string", summary: "the repository's name, <name>-seed-standard, when the folder is named otherwise (a repository converted in place during its rename); validated instead of the folder" },
    },
    run: (context, flags) => {
        if (flags.action !== "init") return Promise.reject(new Refusal("CLI_USAGE", `starci data standard ${flags.action}: the one action is init`, EXIT_USAGE))
        const data = initStandard(resolve(context.cwd, flags.dir ?? "."), { adapter: flags.adapter, force: flags.force, name: flags.name })
        const next = data.adapter ? `; next: npm install --prefix adapter, commit adapter/package-lock.json, author raw/, run node adapter/main.ts` : ""
        const kept = data.kept.length === 0 ? "" : `; kept ${data.kept.join(", ")} (--force rewrites them)`
        const hooks = data.hooksPath ? "; core.hooksPath is .githooks" : "; no git repository yet: run git init, then git config core.hooksPath .githooks"
        return Promise.resolve({ data, message: `${data.name}: wrote ${String(data.written.length)} file(s)${kept}${hooks}${next}` })
    },
})
