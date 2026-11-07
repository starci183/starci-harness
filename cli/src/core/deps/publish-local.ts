import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { z } from "zod"
import { inOrder } from "../../harness/sequential.js"
import { withHeavySlot } from "../../harness/heavy.js"
import { Refusal } from "../../shared/errors.js"
import { captureNpm } from "../../shared/exec.js"
import { branchBase, changedFiles, repositoryRoot } from "../../shared/git.js"
import { formatTable } from "../../shared/output.js"
import { defineVerb, WRITERS } from "../../shared/verb.js"
import type { VerbContext } from "../../shared/verb.js"
import { listPackages } from "../../shared/workspace.js"
import type { WorkspacePackage } from "../../shared/workspace.js"
import { affectedBy } from "../release/affected.js"
import { isHarnessCheckout } from "../release/push-gate.js"
import { ensureRegistry, PORT, registryFlags, registryState, registryUrl, writePublishNpmrc } from "./local-registry.js"
import { localVersionOf, nextLocalNumber } from "./local-version.js"
import { buildPackage, parseManifest, tail } from "./packages.js"
import { withManifest } from "./tarball.js"

interface Row {
    readonly package: string
    readonly version: string
    readonly localVersion: string
    readonly dir: string
}

interface PublishLocalData {
    readonly mode: "plan" | "publish"
    readonly registry: string
    readonly registryState: "up" | "down"
    readonly rows: readonly Row[]
    readonly published: readonly string[]
}

const CLI_DIR = "cli"

/** The dist-tag every local version carries, so no local publish moves `latest` or a prerelease tag of the registry's npm copy. */
const LOCAL_TAG = "local"

const SIBLING_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"] as const

const shippable = (pkg: WorkspacePackage): boolean => !pkg.private && (pkg.relativeDir.startsWith("packages/") || pkg.relativeDir === CLI_DIR)

const versionsSchema = z.union([z.array(z.string()), z.string()])

/** The versions the local registry holds of `name` (its own and npm's through the uplink); empty when it knows none. */
const heldVersions = async (name: string, port: number, cwd: string): Promise<string[]> => {
    const view = await captureNpm(["view", name, "versions", "--json", ...registryFlags(port)], cwd)
    if (view.exitCode !== 0) return []
    let raw: unknown
    try {
        raw = JSON.parse(view.stdout)
    } catch {
        raw = undefined
    }
    const parsed = versionsSchema.safeParse(raw)
    if (!parsed.success) return []
    return typeof parsed.data === "string" ? [parsed.data] : parsed.data
}

/**
 * Every dependency before its dependent, as CI builds them (`release affected` with no base: the build order of each package, a
 * sibling it installs or builds against first), then the CLI.
 */
const globalOrder = async (root: string): Promise<string[]> => {
    const plan = await affectedBy(root, undefined, undefined)
    return [...new Set([...plan.packages.flatMap((one) => one.build), CLI_DIR])]
}

const stepFailed = (what: string, run: { readonly stdout: string; readonly stderr: string }): Refusal => new Refusal("PUBLISH_LOCAL_FAILED", `${what} failed:\n${tail(run.stdout, run.stderr)}`)

/**
 * A package manifest as it is published locally: its version replaced, and every requirement of a sibling published in this run
 * raised to that sibling's local version (a local version satisfies no committed range, so an app would otherwise install the sibling's
 * npm copy beside it).
 */
export const localManifest = (text: string, version: string, siblings: ReadonlyMap<string, string>): string => {
    const manifest: unknown = JSON.parse(text)
    if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) throw new Refusal("DEPS_MANIFEST_UNREADABLE", "a package.json holds a JSON object")
    const edited: Record<string, unknown> = { ...manifest, version }
    for (const field of SIBLING_FIELDS) {
        const table: unknown = edited[field]
        if (typeof table !== "object" || table === null || Array.isArray(table)) continue
        edited[field] = Object.fromEntries(Object.entries(table).map(([name, spec]) => [name, siblings.get(name) ?? spec]))
    }
    return `${JSON.stringify(edited, null, 2)}\n`
}

const packSchema = z.array(z.object({ filename: z.string() })).min(1)

/** Packs the package folder as `npm pack` does (its lifecycle scripts run there), publishes the tarball with its manifest rewritten in memory, and returns nothing: the folder keeps the version in git. */
const publishOne = async (given: { readonly pkg: WorkspacePackage; readonly row: Row; readonly siblings: ReadonlyMap<string, string>; readonly port: number; readonly npmrc: string }): Promise<void> => {
    const { pkg, row, siblings, port, npmrc } = given
    const scratch = mkdtempSync(join(tmpdir(), "starci-publish-local-"))
    try {
        const packed = await withHeavySlot("build", `npm pack ${row.package}`, pkg.dir, {}, (held) => captureNpm(["pack", "--pack-destination", scratch, "--json"], pkg.dir, held.options))
        let raw: unknown
        try {
            raw = JSON.parse(packed.stdout)
        } catch {
            raw = undefined
        }
        const parsed = packSchema.safeParse(raw)
        const filename = parsed.success ? parsed.data[0]?.filename : undefined
        if (packed.exitCode !== 0 || filename === undefined) throw stepFailed(`npm pack of ${row.package}`, packed)
        const archive = join(scratch, filename.replaceAll("/", "-").replace(/^@/, ""))
        const local = join(scratch, `${row.localVersion}.tgz`)
        writeFileSync(local, withManifest(readFileSync(archive), (text) => localManifest(text, row.localVersion, siblings)))
        const published = await withHeavySlot("build", `npm publish ${row.package}`, pkg.dir, {}, (held) => captureNpm(["publish", local, "--tag", LOCAL_TAG, "--provenance=false", "--userconfig", npmrc, ...registryFlags(port)], scratch, held.options))
        if (published.exitCode !== 0) throw stepFailed(`npm publish of ${row.package}@${row.localVersion} to ${registryUrl(port)}`, published)
        const view = await captureNpm(["view", `${row.package}@${row.localVersion}`, "version", ...registryFlags(port)], scratch)
        if (view.exitCode !== 0 || view.stdout.trim() !== row.localVersion) throw new Refusal("PUBLISH_NOT_CONFIRMED", `${row.package}@${row.localVersion} is not readable from ${registryUrl(port)} after publishing`)
    } finally {
        rmSync(scratch, { recursive: true, force: true })
    }
}

/** Builds what the rows need and publishes them in order to the local registry. */
const publishDue = async (context: VerbContext, port: number, given: { readonly root: string; readonly all: readonly WorkspacePackage[]; readonly order: readonly string[]; readonly rows: readonly Row[]; readonly published: string[] }): Promise<void> => {
    const { root, all, order, rows, published } = given
    const npmrc = writePublishNpmrc(port)
    const plan = await affectedBy(root, undefined, undefined)
    const needed = new Set(rows.flatMap((row) => (row.dir === CLI_DIR ? [CLI_DIR] : (plan.packages.find((one) => one.dir === row.dir)?.build ?? [row.dir]))))
    const siblings = new Map(rows.map((row) => [row.package, row.localVersion]))
    await inOrder(
        order.filter((dir) => needed.has(dir)),
        async (dir) => {
            const pkg = all.find((one) => one.relativeDir === dir)
            if (pkg === undefined) return
            context.progress(`building ${pkg.name} in ${pkg.dir}`)
            await buildPackage({ name: pkg.name, folder: pkg.dir, version: pkg.version, builds: pkg.scripts.build !== undefined })
            const row = rows.find((one) => one.dir === dir)
            if (row === undefined) return
            context.progress(`publishing ${row.package}@${row.localVersion} to ${registryUrl(port)}`)
            await publishOne({ pkg, row, siblings, port, npmrc })
            published.push(`${row.package}@${row.localVersion}`)
        },
    )
}

/** The packages to publish: those named by `--package` (a folder or name), else every shippable package this checkout changed since the base of its branch; PUBLISH_LOCAL_NOTHING when none. */
const chosenPackages = async (root: string, all: readonly WorkspacePackage[], named: readonly string[]): Promise<WorkspacePackage[]> => {
    const candidates = all.filter(shippable)
    if (named.length > 0) {
        const chosen = candidates.filter((pkg) => named.some((one) => pkg.relativeDir === one || pkg.name === one || pkg.relativeDir === `packages/${one}`))
        if (chosen.length === 0) throw new Refusal("RELEASE_PACKAGE_UNKNOWN", `no publishable package matches ${named.join(", ")}`)
        return chosen
    }
    const changed = await changedFiles(root, await branchBase(root))
    const chosen = candidates.filter((pkg) => changed.some((file) => file.startsWith(`${pkg.relativeDir}/`)))
    if (chosen.length === 0) throw new Refusal("PUBLISH_LOCAL_NOTHING", "this checkout changed no package since the base of its branch; name the packages with --package")
    return chosen
}

/**
 * `starci deps publish-local`: builds the packages this checkout changed (or the ones `--package` names) and publishes each to the npm
 * registry on this machine under a version of its own (`./local-version.ts`: the next number of its `-local` series), so an app installs
 * it with `starci deps install-local`. The version in git is never touched: the package is packed in its folder and the tarball's
 * manifest is rewritten in memory. A package's requirement of a sibling published in the same run points at the sibling's local
 * version. Dry until `--execute`. It is not a release: nothing reaches npm, and no committed file changes.
 */
export const depsPublishLocalVerb = defineVerb({
    path: ["deps", "publish-local"],
    summary: "build the packages changed here (or --package) and publish each to a registry on this machine (127.0.0.1 only) under its own -local version, for starci deps install-local; dry until --execute",
    editions: ["lite", "full"],
    effect: "host",
    roles: WRITERS,
    schema: "starci/deps-publish-local@2",
    flags: {
        execute: { kind: "boolean", summary: "start or reuse the registry container, build and publish (default: print the plan only)" },
        package: { kind: "list", summary: "this package (its folder or name), repeatable, instead of the packages changed since the base of the branch; its build prerequisites are built, not published" },
        cwd: { kind: "string", summary: "the harness checkout to build and publish (default: the checkout of the working directory)" },
    },
    run: async (context, flags) => {
        const port = PORT
        const root = await repositoryRoot(resolve(flags.cwd ?? context.cwd))
        if (!isHarnessCheckout(root)) throw new Refusal("PUBLISH_LOCAL_NOT_HARNESS", `${root} is not a harness checkout (cli/, contexts/ and packages/); pass --cwd <harness checkout>`)
        const all = listPackages(root)
        const chosen = await chosenPackages(root, all, flags.package)
        if (flags.execute) await ensureRegistry(root)
        const state = await registryState()
        const live = state === "up"
        const rows = await inOrder(chosen, async (pkg): Promise<Row> => {
            const manifest = parseManifest(readFileSync(join(pkg.dir, "package.json"), "utf8"), join(pkg.dir, "package.json"))
            const committed = manifest.version ?? pkg.version
            const held = live ? await heldVersions(pkg.name, port, root) : []
            return { package: pkg.name, version: committed, localVersion: localVersionOf(committed, nextLocalNumber(committed, held)), dir: pkg.relativeDir }
        })
        const order = await globalOrder(root)
        const due = rows.toSorted((left, right) => order.indexOf(left.dir) - order.indexOf(right.dir))
        const published: string[] = []
        if (flags.execute) await publishDue(context, port, { root, all, order, rows: due, published })
        const data: PublishLocalData = { mode: flags.execute ? "publish" : "plan", registry: registryUrl(port), registryState: flags.execute ? "up" : state, rows: due, published }
        const table = formatTable([["PACKAGE", "COMMITTED", "LOCAL VERSION"], ...due.map((row) => [row.package, row.version, row.localVersion])])
        const summary = flags.execute ? `published ${String(published.length)} package(s) to ${registryUrl(port)}` : `${String(due.length)} to publish to ${registryUrl(port)} (registry ${state}; plan only, add --execute)`
        const names = due.map((row) => row.package.replace(/^@starci\//, "")).join(" ")
        return { data, message: [table, summary, `install them in an app: starci deps install-local ${names} --execute (before a commit: starci deps install-local --restore)`].join("\n") }
    },
})
