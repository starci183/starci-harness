import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { z } from "zod"
import { withHeavySlot } from "../../harness/heavy.js"
import { inOrder } from "../../harness/sequential.js"
import { loadLocalSettings, localSettingsPath, writeDevSyncLocal } from "../../harness/local-settings.js"
import { Refusal } from "../../shared/errors.js"
import { captureNpm } from "../../shared/exec.js"
import { captureGit, isAncestor, refExists, repositoryRoot, resolveSha } from "../../shared/git.js"
import { formatTable } from "../../shared/output.js"
import { defineVerb, WRITERS } from "../../shared/verb.js"
import { listPackages } from "../../shared/workspace.js"
import type { WorkspacePackage } from "../../shared/workspace.js"
import { affectedBy } from "../release/affected.js"
import { isHarnessCheckout } from "../release/harness-checkout.js"
import { NPMJS_FLAGS } from "./local-refs.js"
import { ensureRegistry, LOCAL_TAG, PORT, registryFlags, registryFolder, registryUrl, registryVersions, writePublishNpmrc } from "./local-registry.js"
import { packStamped } from "./pack-stamped.js"
import { parseRequested } from "./install-local.js"
import { buildPackage, tail } from "./packages.js"
import { globalOrder } from "./publish-local.js"
import { copyPins, pinnedManifest, siblingSpecs } from "./publish-pins.js"

export { PIN_FIELDS } from "./publish-pins.js"

/**
 * The dev line of the harness on the local registry (owner 2026-11-22: "bản thân .claude cũng tách thành dev main được không? dev code xong merge
 * nhanh để xài local"; "merge hết vô local dc không? pin 1 lần prod phát hành ntn kệ nó, và update .claude để tối đa hóa thời gian code local").
 * Once a harness batch lands on `dev`, every package it changed and every package that pins one of them (its `dependencies`, `peerDependencies` or
 * `optionalDependencies`, the real graph of the package.json files) is published to the local registry as a prerelease `X.Y.Z-dev.N`: X.Y.Z the next
 * release of the package, N one more than any dev build of it the registry lists or this machine counted. The publish copy (the tarball's manifest,
 * never a committed file) carries that version and pins each sibling of the dev line exactly, so `dev` stays free of dev pins and npm installs the
 * set as published. `devSync.local` of this machine's local settings then names exactly those versions (the `local` dist-tag moves with every publish),
 * and the lander's after-land dev sync installs them into the app's dev checkout. Nothing reaches npm; main and every release stay plain versions.
 */

/** The trees the CLI's tarball carries beside cli/ (its prepack copies them), so a change there is the CLI's. */
const CLI_TREES = ["contexts/", "ops/", "policy/", "skills/", "hfs.json", "CONTRIBUTING.md", "packages/README.md", "packages/jest-preset/README.md", "README.md", "LICENSE"]

const CLI_DIR = "cli"

/** A package of the dev line: published to npm by a release, never private, a folder under packages/ or the CLI. */
export const shipsOnDevLine = (pkg: Pick<WorkspacePackage, "private" | "relativeDir">): boolean => !pkg.private && (pkg.relativeDir.startsWith("packages/") || pkg.relativeDir === CLI_DIR)

/** A dev build's version: `0.56.0-dev.3`, or on a prerelease line `1.1.0-alpha.195.dev.3`. */
const DEV_SUFFIX = /[-.]dev\.(\d+)$/

/** Whether a version is a dev build of the dev line. Pure. */
export const isDevVersion = (version: string): boolean => DEV_SUFFIX.test(version)

/** The release a dev build leads to: `0.56.0-dev.3` -> `0.56.0`. Pure. */
export const releaseOf = (version: string): string => version.replace(DEV_SUFFIX, "")

/** A package as the dev line reads it: its name, folder, committed version and the siblings it requires once installed. */
export interface DevNode {
    readonly name: string
    readonly dir: string
    readonly version: string
    readonly requires: ReadonlySet<string>
}

/** The dev-line nodes of a repository's packages, read from each package.json. */
export const devNodes = (packages: readonly WorkspacePackage[]): DevNode[] =>
    packages.filter(shipsOnDevLine).map((pkg) => {
        const manifest: unknown = JSON.parse(readFileSync(join(pkg.dir, "package.json"), "utf8"))
        const pins = typeof manifest === "object" && manifest !== null ? siblingSpecs(manifest as Record<string, unknown>) : new Map<string, string>()
        return { name: pkg.name, dir: pkg.relativeDir, version: pkg.version, requires: new Set(pins.keys()) }
    })

/** The dev-line packages owning a changed file: the package whose folder holds it, and the CLI for a tree its tarball carries. Pure. */
export const changedNodes = (nodes: readonly DevNode[], files: readonly string[]): Set<string> => {
    const changed = new Set<string>()
    for (const file of files) {
        const owner = nodes.find((node) => file.startsWith(`${node.dir}/`))
        if (owner !== undefined) changed.add(owner.name)
        if (CLI_TREES.some((tree) => file === tree || file.startsWith(tree))) {
            const cli = nodes.find((node) => node.dir === CLI_DIR)
            if (cli !== undefined) changed.add(cli.name)
        }
    }
    return changed
}

/**
 * The closure of a set of changed packages: they, and every package that requires one of the closure, transitively. A dev build of a package is a
 * version no range of its dependents admits (a prerelease), so each dependent is published again pinning it exactly. Pure.
 */
export const devClosure = (nodes: readonly DevNode[], changed: ReadonlySet<string>): Set<string> => {
    const closure = new Set([...changed].filter((name) => nodes.some((node) => node.name === name)))
    let grew = true
    while (grew) {
        grew = false
        for (const node of nodes) {
            if (closure.has(node.name) || ![...node.requires].some((name) => closure.has(name))) continue
            closure.add(node.name)
            grew = true
        }
    }
    return closure
}

/**
 * The next release of a package whose committed version is `version`: that version while npm does not serve it (its bump is already committed), else
 * the next patch (`0.55.0` -> `0.55.1`), or on a prerelease line the next prerelease (`1.1.0-alpha.194` -> `1.1.0-alpha.195`). Pure.
 */
export const nextRelease = (version: string, onNpm: boolean): string => {
    if (!onNpm) return version
    const pre = /^(\d+\.\d+\.\d+-.*?)(\d+)$/.exec(version)
    if (pre !== null) return `${pre[1] ?? ""}${String(Number(pre[2]) + 1)}`
    if (version.includes("-")) return `${version}.1`
    const [major = "0", minor = "0", patch = "0"] = version.split(".")
    return `${major}.${minor}.${String(Number(patch) + 1)}`
}

/** The dev build `n` of the release `next`. Pure. */
export const devVersion = (next: string, n: number): string => `${next}${next.includes("-") ? "." : "-"}dev.${String(n)}`

/** The number of the next dev build of `next`: one more than any the registry lists of it and the machine's counter. Pure. */
export const nextDevNumber = (next: string, listed: readonly string[], counted = 0): number => {
    const numbers = listed.filter((version) => isDevVersion(version) && releaseOf(version) === next).map((version) => Number(DEV_SUFFIX.exec(version)?.[1] ?? "0"))
    return Math.max(counted, ...numbers, 0) + 1
}

/**
 * A package manifest's text as its dev build publishes it: `version` set, and every requirement in PIN_FIELDS of a package `pins` names set to that exact
 * version, ranges too (no range admits a prerelease); devDependencies and `file:` specs are left as they are (publish-pins.ts). Pure.
 */
export const devManifest = (text: string, version: string, pins: ReadonlyMap<string, string>): string => pinnedManifest(text, version, pins, true)

/** One package of a dev publish. */
export interface DevRow {
    readonly package: string
    readonly dir: string
    /** The version committed in git. */
    readonly committed: string
    /** The release it leads to. */
    readonly next: string
    /** The dev build published. */
    readonly version: string
    /** Why it is published: its own change, or a sibling it pins. */
    readonly why: "changed" | "pins a dev build"
}

/** What a plan asks of the world: whether npm serves a version, the versions the local registry lists, and this machine's counter. Specs replace it. */
export interface DevQuestions {
    readonly onNpm: (name: string, version: string) => Promise<boolean>
    readonly listed: (name: string) => Promise<readonly string[]>
    readonly counted: (name: string, next: string) => number
}

/** The plan of one dev publish: the rows, the exact pins of the publish copies, and the `devSync.local` entries it leaves. */
export interface DevPlan {
    readonly rows: readonly DevRow[]
    readonly pins: ReadonlyMap<string, string>
    readonly local: readonly string[]
    /** Entries of the overlay a release caught up with (npm serves their release), dropped. */
    readonly dropped: readonly string[]
}

/**
 * Plans a dev publish. `overlay` is this machine's `devSync.local`: a dev build it names stays pinned by the publish copies (an app installs it beside
 * them) unless npm now serves its release, which drops it; a package republished here replaces its entry. The rows come in `order` (dependencies
 * first, as CI builds them).
 */
export const planDevPublish = async (given: { readonly nodes: readonly DevNode[]; readonly changed: ReadonlySet<string>; readonly overlay: readonly string[]; readonly order: readonly string[]; readonly asked: DevQuestions }): Promise<DevPlan> => {
    const { nodes, changed, overlay, order, asked } = given
    const closure = devClosure(nodes, changed)
    const byName = new Map(nodes.map((node) => [node.name, node]))
    const chosen = [...closure].map((name) => byName.get(name)).filter((node): node is DevNode => node !== undefined).toSorted((left, right) => order.indexOf(left.dir) - order.indexOf(right.dir))
    const rows = await inOrder(chosen, async (node): Promise<DevRow> => {
        const next = nextRelease(node.version, await asked.onNpm(node.name, node.version))
        const version = devVersion(next, nextDevNumber(next, await asked.listed(node.name), asked.counted(node.name, next)))
        return { package: node.name, dir: node.dir, committed: node.version, next, version, why: changed.has(node.name) ? "changed" : "pins a dev build" }
    })
    const kept: string[] = []
    const dropped: string[] = []
    const pins = new Map<string, string>()
    await inOrder(overlay, async (entry) => {
        const { name, version } = parseRequested(entry)
        if (rows.some((row) => row.package === name)) return
        if (version !== undefined && isDevVersion(version)) {
            if (await asked.onNpm(name, releaseOf(version))) {
                dropped.push(entry)
                return
            }
            pins.set(name, version)
        }
        kept.push(entry)
    })
    for (const row of rows) pins.set(row.package, row.version)
    const local = [...kept, ...rows.map((row) => `${row.package}@${row.version}`)].toSorted((left, right) => left.localeCompare(right))
    return { rows, pins, local, dropped }
}

const recordSchema = z.object({ schema: z.literal("starci/dev-publish@1"), sha: z.string(), at: z.string(), versions: z.array(z.string()) })

/** The last dev publish of this machine: the dev commit it published and the versions. */
export type DevRecord = z.infer<typeof recordSchema>

/** Where this machine keeps its dev line: the record of the last dev publish and the counter of dev builds, beside the local registry's files. */
export const devLineFiles = (folder: string = registryFolder()): { readonly record: string; readonly counter: string } => ({ record: join(folder, "dev-publish.json"), counter: join(folder, "dev-counter.json") })

/** Reads the last dev publish; undefined when none was recorded or the file is not one. */
export const readDevRecord = (file: string): DevRecord | undefined => {
    try {
        const parsed = recordSchema.safeParse(JSON.parse(readFileSync(file, "utf8")))
        return parsed.success ? parsed.data : undefined
    } catch {
        return undefined
    }
}

const counterSchema = z.record(z.string(), z.number().int().min(0))

/** The machine's counter of dev builds, `<name>@<next>` to the last N published; empty when absent. */
export const readCounter = (file: string): Record<string, number> => {
    try {
        const parsed = counterSchema.safeParse(JSON.parse(readFileSync(file, "utf8")))
        return parsed.success ? parsed.data : {}
    } catch {
        return {}
    }
}

const writeJson = (file: string, value: unknown): void => {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

/** The dev number of a dev build. Pure. */
const devNumber = (version: string): number => Number(DEV_SUFFIX.exec(version)?.[1] ?? "0")

/** The world an executed dev publish touches: build, publish, the files of this machine. Specs replace it. */
export interface DevPublishIo {
    readonly build: (pkg: WorkspacePackage) => Promise<void>
    /** The tree's versions and whether a registry serves one: a sibling the dev line does not carry is pinned at the tree's version when served (publish-pins.ts). */
    readonly treePins?: { readonly tree: ReadonlyMap<string, string>; readonly served: (name: string, version: string) => boolean }
    readonly publish: (pkg: WorkspacePackage, row: DevRow, edit: (text: string) => string) => Promise<void>
    readonly files: { readonly record: string; readonly counter: string; readonly settings: string }
    readonly say: (line: string) => void
}

/** The pins of one dev copy: the dev line's, then the tree's for a sibling outside it (copyPins). Pure. */
const withTreePins = (text: string, pins: ReadonlyMap<string, string>, tree: DevPublishIo["treePins"]): ReadonlyMap<string, string> => {
    if (tree === undefined) return pins
    const manifest: unknown = JSON.parse(text)
    if (typeof manifest !== "object" || manifest === null) return pins
    return new Map([...copyPins(manifest as Record<string, unknown>, pins, tree.tree, tree.served), ...pins])
}

/** What one dev publish did. */
export interface DevPublishData {
    readonly mode: "plan" | "publish" | "unchanged"
    readonly since: string | null
    readonly head: string
    readonly rows: readonly DevRow[]
    readonly local: readonly string[]
    readonly dropped: readonly string[]
    readonly published: readonly string[]
}

/**
 * Executes a plan: builds what the rows need in `order` (a row's build prerequisites included), publishes each row's copy with its dev manifest, counts
 * each build, then records the publish and writes `devSync.local`. The record and the setting are written only once every row is published, so a run
 * that stops part way is run again whole (each rerun takes new numbers; nothing is replaced). Returns the published `name@version`.
 */
export const executeDevPlan = async (given: { readonly plan: DevPlan; readonly packages: readonly WorkspacePackage[]; readonly order: readonly string[]; readonly needs: (dir: string) => readonly string[]; readonly head: string; readonly io: DevPublishIo }): Promise<string[]> => {
    const { plan, packages, order, needs, head, io } = given
    const needed = new Set(plan.rows.flatMap((row) => needs(row.dir)))
    const published: string[] = []
    await inOrder(order.filter((dir) => needed.has(dir)), async (dir) => {
        const pkg = packages.find((one) => one.relativeDir === dir)
        if (pkg === undefined) return
        io.say(`building ${pkg.name}`)
        await io.build(pkg)
        const row = plan.rows.find((one) => one.dir === dir)
        if (row === undefined) return
        io.say(`publishing ${row.package}@${row.version} (${row.why})`)
        await io.publish(pkg, row, (text) => devManifest(text, row.version, withTreePins(text, plan.pins, io.treePins)))
        const counter = readCounter(io.files.counter)
        writeJson(io.files.counter, { ...counter, [`${row.package}@${row.next}`]: Math.max(counter[`${row.package}@${row.next}`] ?? 0, devNumber(row.version)) })
        published.push(`${row.package}@${row.version}`)
    })
    writeJson(io.files.record, { schema: "starci/dev-publish@1", sha: head, at: new Date().toISOString(), versions: [...plan.local] } satisfies DevRecord)
    writeDevSyncLocal(io.files.settings, plan.local)
    return published
}

/** Packs the package with its dev manifest and publishes it to the local registry under the `local` tag, then reads it back. */
const publishDevCopy = async (root: string, pkg: WorkspacePackage, row: DevRow, edit: (text: string) => string, npmrc: string): Promise<void> => {
    const scratch = mkdtempSync(join(tmpdir(), "starci-publish-dev-"))
    try {
        const tarball = await packStamped({ pkg, root, scratch, name: `${row.version}.tgz`, edit })
        const published = await withHeavySlot("build", `npm publish ${row.package}@${row.version}`, pkg.dir, {}, (held) => captureNpm(["publish", tarball, "--tag", LOCAL_TAG, "--provenance=false", "--userconfig", npmrc, ...registryFlags(PORT)], scratch, held.options))
        if (published.exitCode !== 0) throw new Refusal("PUBLISH_LOCAL_FAILED", `npm publish of ${row.package}@${row.version} to ${registryUrl(PORT)} failed:\n${tail(published.stdout, published.stderr)}`)
        const view = await captureNpm(["view", `${row.package}@${row.version}`, "version", ...registryFlags(PORT)], scratch)
        if (view.exitCode !== 0 || view.stdout.trim() !== row.version) throw new Refusal("PUBLISH_NOT_CONFIRMED", `${row.package}@${row.version} is not readable from ${registryUrl(PORT)} after publishing`)
    } finally {
        rmSync(scratch, { recursive: true, force: true })
    }
}

const servedByNpm = async (root: string, name: string, version: string): Promise<boolean> => {
    const view = await captureNpm(["view", `${name}@${version}`, "version", ...NPMJS_FLAGS], root)
    return view.exitCode === 0 && view.stdout.trim() === version
}

/** The tree's versions of the dev line, and which of them the local registry lists (its npm uplink included). */
const treeServed = async (root: string, packages: readonly WorkspacePackage[]): Promise<{ readonly tree: ReadonlyMap<string, string>; readonly served: (name: string, version: string) => boolean }> => {
    const shipped = packages.filter(shipsOnDevLine)
    const listed = new Map(await inOrder(shipped, async (pkg) => [pkg.name, await registryVersions(pkg.name, PORT, root)] as const))
    return { tree: new Map(shipped.map((pkg) => [pkg.name, pkg.version])), served: (name, version) => listed.get(name)?.includes(version) ?? false }
}

/**
 * Where a dev publish measures from: `since` when given; else the dev commit the last recorded publish of this machine published, when it is on
 * this history; else where HEAD forks from origin/main (everything dev holds beyond the last release).
 */
export const devSince = async (root: string, head: string, since: string | undefined, record: DevRecord | undefined): Promise<string | null> => {
    if (since !== undefined && since !== "") return resolveSha(root, since)
    if (record !== undefined && (await refExists(root, record.sha)) && (await isAncestor(root, record.sha, head))) return record.sha
    if (!(await refExists(root, "origin/main"))) return null
    const fork = await captureGit(["merge-base", head, "origin/main"], root)
    return fork.exitCode === 0 && fork.stdout.trim() !== "" ? fork.stdout.trim() : null
}

/**
 * Plans, and with `execute` performs, the dev publish of the harness checkout `root` at `head`. Safe to run again: a head the last record already
 * published is `unchanged` (its `devSync.local` is written again as recorded); a dry run publishes nothing and writes nothing.
 */
export const publishDev = async (given: { readonly root: string; readonly head?: string | undefined; readonly since?: string | undefined; readonly execute: boolean; readonly say: (line: string) => void; readonly folder?: string | undefined; readonly settings?: string | undefined }): Promise<DevPublishData> => {
    const { root, execute, say } = given
    if (!isHarnessCheckout(root)) throw new Refusal("PUBLISH_LOCAL_NOT_HARNESS", `${root} is not a harness checkout (cli/, contexts/ and packages/): the dev line is the harness's`)
    const head = await resolveSha(root, given.head ?? "HEAD")
    const files = { ...devLineFiles(given.folder), settings: given.settings ?? localSettingsPath() }
    const record = readDevRecord(files.record)
    if (given.since === undefined && record?.sha === head) {
        if (execute) writeDevSyncLocal(files.settings, record.versions)
        return { mode: "unchanged", since: head, head, rows: [], local: record.versions, dropped: [], published: [] }
    }
    const since = await devSince(root, head, given.since, record)
    const diff = since === null ? undefined : await captureGit(["diff", "--name-only", "--no-renames", "-z", since, head], root)
    const packages = listPackages(root)
    const nodes = devNodes(packages)
    const changed = diff === undefined ? new Set(nodes.map((node) => node.name)) : changedNodes(nodes, diff.stdout.split("\0").filter((file) => file !== ""))
    if (execute) await ensureRegistry(root)
    const counter = readCounter(files.counter)
    const order = await globalOrder(root)
    const plan = await planDevPublish({
        nodes, changed, order,
        overlay: loadLocalSettings(files.settings).devSync.local,
        asked: { onNpm: (name, version) => servedByNpm(root, name, version), listed: (name) => registryVersions(name, PORT, root), counted: (name, next) => counter[`${name}@${next}`] ?? 0 },
    })
    if (!execute) return { mode: "plan", since, head, rows: plan.rows, local: plan.local, dropped: plan.dropped, published: [] }
    const npmrc = writePublishNpmrc(PORT)
    const affected = await affectedBy(root, undefined, undefined)
    const needs = (dir: string): readonly string[] => (dir === CLI_DIR ? [CLI_DIR] : (affected.packages.find((one) => one.dir === dir)?.build ?? [dir]))
    const treePins = await treeServed(root, packages)
    const published = await executeDevPlan({
        plan, packages, order, needs, head,
        io: {
            treePins,
            build: (pkg) => buildPackage({ name: pkg.name, folder: pkg.dir, version: pkg.version, builds: pkg.scripts.build !== undefined }),
            publish: (pkg, row, edit) => publishDevCopy(root, pkg, row, edit, npmrc),
            files, say,
        },
    })
    return { mode: "publish", since, head, rows: plan.rows, local: plan.local, dropped: plan.dropped, published }
}

/** The report of a dev publish. Pure. */
export const devPublishMessage = (data: DevPublishData): string => {
    if (data.mode === "unchanged") return `the dev line is already published at ${data.head.slice(0, 10)}; devSync.local: ${data.local.join(", ") || "(empty)"}`
    const table = formatTable([["PACKAGE", "COMMITTED", "DEV BUILD", "WHY"], ...data.rows.map((row) => [row.package, row.committed, row.version, row.why])])
    const what = data.mode === "publish" ? `published ${String(data.published.length)} dev build(s) to ${registryUrl(PORT)}` : `${String(data.rows.length)} dev build(s) to publish (plan only, add --execute)`
    return [
        `measured from ${data.since === null ? "nothing (every package)" : data.since.slice(0, 10)} to ${data.head.slice(0, 10)}`,
        table,
        what,
        ...(data.dropped.length > 0 ? [`dropped from devSync.local (npm serves their release): ${data.dropped.join(", ")}`] : []),
        `devSync.local${data.mode === "publish" ? "" : " would be"}: ${data.local.join(", ") || "(empty)"}`,
    ].join("\n")
}

/**
 * `starci deps publish-dev`: the dev line of the harness on this machine's registry. It is what the harness's batch lander runs after a batch lands
 * on dev (local setting `devSync.publishLocal`), and a hand run does the same: dry until --execute, idempotent.
 */
export const depsPublishDevVerb = defineVerb({
    path: ["deps", "publish-dev"],
    summary: "publish the harness's dev line to the registry on this machine: every package changed since the last dev publish (or --since) and every package that pins one of them, each as X.Y.Z-dev.N (the next release, N monotonic), its publish copy pinning the dev builds exactly (no committed file changes); then devSync.local of the local settings names exactly those versions; dry until --execute, a rerun at the same head changes nothing",
    effect: "host",
    roles: WRITERS,
    schema: "starci/deps-publish-dev@1",
    flags: {
        execute: { kind: "boolean", summary: "build, publish and write devSync.local (default: print the plan only)" },
        since: { kind: "string", summary: "measure the change from this commit (default: the last dev publish of this machine, else where HEAD forks from origin/main)" },
        cwd: { kind: "string", summary: "the harness checkout at the dev commit to publish (default: the checkout of the working directory)" },
    },
    run: async (context, flags) => {
        const root = await repositoryRoot(resolve(flags.cwd ?? context.cwd))
        if (!existsSync(join(root, "packages"))) throw new Refusal("PUBLISH_LOCAL_NOT_HARNESS", `${root} holds no packages/`)
        const data = await publishDev({ root, since: flags.since, execute: flags.execute, say: context.progress })
        return { data, message: devPublishMessage(data) }
    },
})
