import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { StoredEntry } from "../copies.ts"
import { memorySpool, spooledSource } from "../copies.ts"
import { DataRefusal } from "../driver.ts"
import { ManifestBuilder } from "../manifest.ts"
import type { Runner } from "./driver.ts"
import { createGitDriver } from "./driver.ts"

/**
 * The adapter of a seed-standard repository (PROJECT-STACKS-13): a standard whose content is awkward to author as JSON
 * records keeps what people write in `raw/` and an `adapter/` whose `convert(rawDir)` turns it into entries; this file
 * writes those entries through the one git driver into the standard layout (`manifest.json`, `data/`, `blobs/`,
 * `index/`), so an adapter never writes a copy file itself.
 *
 * Determinism is the contract the commit hook proves (R434, HFS_DATA_ADAPTER_DRIFT): the same `raw/` yields the same
 * bytes. The driver already sorts sets and keys and writes canonical JSON; this file fixes the rest: `takenAt` is
 * STANDARD_TAKEN_AT (a standard is identified by its commit, never by a time) and `source.environment` is
 * STANDARD_ENVIRONMENT. What is left to the adapter is its content: no clock, no random id, no order the file system
 * chose.
 */

/** The `takenAt` of every standard an adapter renders: fixed, so the manifest is a function of `raw/` alone. */
export const STANDARD_TAKEN_AT = "1970-01-01T00:00:00.000Z"
/** The `source.environment` of a rendered standard: it belongs to every environment that loads it, so it names none. */
export const STANDARD_ENVIRONMENT = "standard"
/** What an adapter run writes at the root of the standard, and all it may write: the rest of the repository is people's. */
export const STANDARD_OUTPUTS: readonly string[] = Object.freeze(["manifest.json", "data", "blobs", "index"])
/** The folder people author in, kept plain; never written by an adapter. */
export const STANDARD_RAW = "raw"

const STANDARD_FORMAT = /^[a-z0-9][a-z0-9-]*-seed-standard@[1-9]\d*$/u

/** What `convert` answers: the standard's format (`<name>-seed-standard@<major>`), its project and every entry with its store. */
export interface StandardContent {
    /** `<repository name>@<major>`; the name ends `-seed-standard`. */
    readonly format: string
    /** The project the standard seeds. */
    readonly project: string
    /** Every entry, each with the store id it is loaded into (a store `data.stores` of the app declares). Any order. */
    readonly entries: readonly StoredEntry[]
}

/** An adapter's one export: reads `rawDir` (the standard's `raw/`) and answers its content; it writes nothing. */
export type StandardConvert = (rawDir: string) => StandardContent | Promise<StandardContent>

/** Seams of a render: the program runner of the git driver, and where its scratch working copy is made. */
export interface RenderOptions {
    /** Runs git; spawnSync by default. */
    readonly run?: Runner
    /** The parent of the scratch working copy; the system temp directory by default. */
    readonly scratch?: string
}

/** The git identity and configuration of the scratch working copy: nothing of the machine's git configuration reaches it. */
const SCRATCH_GIT: Readonly<Record<string, string>> = Object.freeze({
    GIT_AUTHOR_NAME: "starci-seed",
    GIT_AUTHOR_EMAIL: "seed@starci.invalid",
    GIT_COMMITTER_NAME: "starci-seed",
    GIT_COMMITTER_EMAIL: "seed@starci.invalid",
    GIT_CONFIG_NOSYSTEM: "1",
})

/**
 * Writes `content` into `outDir` as a seed-standard: the entries go through `createGitDriver` into a scratch working copy
 * (plaintext, the standard's purpose), and its `manifest.json`, `data/`, `blobs/` and `index/` replace those of `outDir`.
 * A format that is no standard's is refused `DATA_FORM_REFUSED`; a repeated key or a set mixing forms is the manifest
 * builder's TypeError.
 */
export async function renderStandard(content: StandardContent, outDir: string, options: RenderOptions = {}): Promise<void> {
    if (!STANDARD_FORMAT.test(content.format))
        throw new DataRefusal("DATA_FORM_REFUSED", "configuration", { format: content.format, reason: "a standard's format is <name>-seed-standard@<major>" })
    const builder = new ManifestBuilder()
    const spool = memorySpool()
    for (const item of content.entries) {
        builder.add(item.store, item.entry)
        await spool.append(item)
    }
    const manifest = builder.build({ format: content.format, purpose: "seed-standard", takenAt: STANDARD_TAKEN_AT, source: { project: content.project, environment: STANDARD_ENVIRONMENT } })
    const scratch = mkdtempSync(join(options.scratch ?? tmpdir(), "seed-standard-"))
    try {
        const config = join(scratch, "gitconfig")
        writeFileSync(config, "")
        const checkout = join(scratch, "copy")
        const driver = createGitDriver({ id: content.format, checkout, env: { ...SCRATCH_GIT, GIT_CONFIG_GLOBAL: config }, ...(options.run === undefined ? {} : { run: options.run }) })
        await driver.write(spooledSource(manifest, spool), { recipients: [], dryRun: false })
        mkdirSync(outDir, { recursive: true })
        for (const name of STANDARD_OUTPUTS) {
            rmSync(join(outDir, name), { recursive: true, force: true })
            if (existsSync(join(checkout, name))) cpSync(join(checkout, name), join(outDir, name), { recursive: true })
        }
    } finally {
        rmSync(scratch, { recursive: true, force: true })
    }
}

/** Where an adapter run prints. */
export interface AdapterIo {
    /** The directory `--raw` and `--out` resolve against; the process's by default. */
    readonly cwd?: string
    /** Prints one line of the run; stderr by default. */
    readonly print?: (line: string) => void
}

const ADAPTER_USAGE = "usage: node adapter/main.ts [--raw <dir>] [--out <dir>] (defaults: raw and the repository root, from the repository root)"

/** The `--raw` and `--out` of an adapter run, or a usage problem. */
function adapterArgs(argv: readonly string[]): { raw: string; out: string } | string {
    const values: Record<string, string> = { "--raw": STANDARD_RAW, "--out": "." }
    for (let at = 0; at < argv.length; at += 2) {
        const flag = String(argv[at])
        const value = argv[at + 1]
        if (!(flag in values) || value === undefined || value.startsWith("--")) return `${flag} is no flag of an adapter run, or has no value`
        values[flag] = value
    }
    return { raw: String(values["--raw"]), out: String(values["--out"]) }
}

/**
 * The body of an adapter's `main.ts`: `process.exitCode = await runStandardAdapter(convert, process.argv.slice(2))`.
 * Converts `--raw` (default `raw`) and renders the standard into `--out` (default `.`, the repository root): exit 0;
 * a usage problem is 2, a failed convert or render 1, with the refusal's code or the error on one line.
 */
export async function runStandardAdapter(convert: StandardConvert, argv: readonly string[], io: AdapterIo = {}): Promise<number> {
    const print = io.print ?? ((line: string): void => void process.stderr.write(`${line}\n`))
    const args = adapterArgs(argv)
    if (typeof args === "string") {
        print(`${args}; ${ADAPTER_USAGE}`)
        return 2
    }
    const cwd = io.cwd ?? process.cwd()
    try {
        await renderStandard(await convert(resolve(cwd, args.raw)), resolve(cwd, args.out))
        return 0
    } catch (cause) {
        print(`the adapter failed: ${cause instanceof DataRefusal ? cause.code : String(cause)}`)
        return 1
    }
}
