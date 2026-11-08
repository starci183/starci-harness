import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
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
import { ensureRegistry, LOCAL_TAG, PORT, registryFlags, registryState, registryUrl, registryVersions, writePublishNpmrc } from "./local-registry.js"
import { npmCopy } from "./npm-copy.js"
import type { NpmCopy } from "./npm-copy.js"
import { buildPackage, parseManifest, tail } from "./packages.js"
import { packStamped, sourceDigest } from "./pack-stamped.js"

/** What npm serves of a version this checkout publishes: nothing, or a copy of the same source. */
type NpmState = "unserved" | "same source"

interface Row {
    readonly package: string
    readonly version: string
    readonly dir: string
    readonly npm: NpmState
    /** Whether the local registry already lists the version (a publish replaces it); undefined while the registry is down. */
    readonly replaces: boolean | undefined
}

/** A row with what the publish itself needs: the copy npm serves, judged again against the source as built. */
interface Planned extends Row {
    readonly served: NpmCopy | undefined
}

interface PublishLocalData {
    readonly mode: "plan" | "publish"
    readonly registry: string
    readonly registryState: "up" | "down"
    readonly rows: readonly Row[]
    readonly published: readonly string[]
}

const CLI_DIR = "cli"

const shippable = (pkg: WorkspacePackage): boolean => !pkg.private && (pkg.relativeDir.startsWith("packages/") || pkg.relativeDir === CLI_DIR)

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
 * Judges a version against what npm serves of it: a version npm does not serve is free, one it serves with the same source digest is the
 * same content, and any other is refused PUBLISH_LOCAL_VERSION_TAKEN, since one version never names two contents (an app pins a version, and
 * its check cache keys on the digest).
 */
export const judgeVersion = (name: string, version: string, digest: string, served: NpmCopy | undefined): NpmState => {
    if (served === undefined) return "unserved"
    if (served.source === digest) return "same source"
    const theirs = served.source === undefined ? "no source digest (it was published before packages carried one), so its content cannot be shown equal" : `source ${served.source.slice(0, 12)}`
    throw new Refusal("PUBLISH_LOCAL_VERSION_TAKEN", `npm already serves ${name}@${version} with ${theirs}; this checkout's source is ${digest.slice(0, 12)}. Two contents never share a version: raise the version in package.json (with its CHANGELOG entry) and publish that`)
}

/** What planning a publish asks of the world: the copy npm serves of a version, and the versions the local registry lists (undefined while it is down). The specs replace it. */
export interface PlanQuestions {
    readonly served: (name: string, version: string) => Promise<NpmCopy | undefined>
    readonly listed: ((name: string) => Promise<readonly string[]>) | undefined
}

/** The plan of one package: the version committed in its folder, judged against what npm serves of it, and whether the registry already lists it. */
export const planOne = async (root: string, pkg: WorkspacePackage, asked: PlanQuestions): Promise<Planned> => {
    const file = join(pkg.dir, "package.json")
    const version = parseManifest(readFileSync(file, "utf8"), file).version ?? pkg.version
    const served = await asked.served(pkg.name, version)
    const npm = judgeVersion(pkg.name, version, await sourceDigest(root, pkg.relativeDir), served)
    const replaces = asked.listed === undefined ? undefined : (await asked.listed(pkg.name)).includes(version)
    return { package: pkg.name, version, dir: pkg.relativeDir, npm, replaces, served }
}

/** Packs the package folder with its source digest stamped and publishes the tarball to the local registry as it is: the version in git, replacing the copy of that version the registry lists (an unpublish, then the publish). */
const publishOne = async (given: { readonly pkg: WorkspacePackage; readonly root: string; readonly row: Planned; readonly port: number; readonly npmrc: string }): Promise<void> => {
    const { pkg, root, row, port, npmrc } = given
    const scratch = mkdtempSync(join(tmpdir(), "starci-publish-local-"))
    try {
        judgeVersion(row.package, row.version, await sourceDigest(root, pkg.relativeDir), row.served)
        const local = await packStamped({ pkg, root, scratch, name: `${row.version}.tgz` })
        if ((await registryVersions(row.package, port, scratch)).includes(row.version)) {
            const removed = await captureNpm(["unpublish", `${row.package}@${row.version}`, "--force", "--userconfig", npmrc, ...registryFlags(port)], scratch)
            if (removed.exitCode !== 0) throw stepFailed(`npm unpublish of ${row.package}@${row.version} from ${registryUrl(port)}`, removed)
        }
        const published = await withHeavySlot("build", `npm publish ${row.package}`, pkg.dir, {}, (held) => captureNpm(["publish", local, "--tag", LOCAL_TAG, "--provenance=false", "--userconfig", npmrc, ...registryFlags(port)], scratch, held.options))
        if (published.exitCode !== 0) throw stepFailed(`npm publish of ${row.package}@${row.version} to ${registryUrl(port)}`, published)
        const view = await captureNpm(["view", `${row.package}@${row.version}`, "version", ...registryFlags(port)], scratch)
        if (view.exitCode !== 0 || view.stdout.trim() !== row.version) throw new Refusal("PUBLISH_NOT_CONFIRMED", `${row.package}@${row.version} is not readable from ${registryUrl(port)} after publishing`)
    } finally {
        rmSync(scratch, { recursive: true, force: true })
    }
}

/** Builds what the rows need and publishes them in order to the local registry. */
const publishDue = async (context: VerbContext, port: number, given: { readonly root: string; readonly all: readonly WorkspacePackage[]; readonly order: readonly string[]; readonly rows: readonly Planned[]; readonly published: string[] }): Promise<void> => {
    const { root, all, order, rows, published } = given
    const npmrc = writePublishNpmrc(port)
    const plan = await affectedBy(root, undefined, undefined)
    const needed = new Set(rows.flatMap((row) => (row.dir === CLI_DIR ? [CLI_DIR] : (plan.packages.find((one) => one.dir === row.dir)?.build ?? [row.dir]))))
    await inOrder(
        order.filter((dir) => needed.has(dir)),
        async (dir) => {
            const pkg = all.find((one) => one.relativeDir === dir)
            if (pkg === undefined) return
            context.progress(`building ${pkg.name} in ${pkg.dir}`)
            await buildPackage({ name: pkg.name, folder: pkg.dir, version: pkg.version, builds: pkg.scripts.build !== undefined })
            const row = rows.find((one) => one.dir === dir)
            if (row === undefined) return
            context.progress(`publishing ${row.package}@${row.version} to ${registryUrl(port)}`)
            await publishOne({ pkg, root, row, port, npmrc })
            published.push(`${row.package}@${row.version}`)
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
 * registry on this machine under the version committed in git, so an app installs it with `starci deps install-local` and the pins, the peer
 * ranges and the cache keys are the ones the npm build will have. A version npm serves is published only when npm's copy carries the same
 * source digest (`judgeVersion`); a rebuild of a version replaces the registry's copy. Dry until `--execute`. It is not a release: nothing
 * reaches npm, and no committed file changes.
 */
export const depsPublishLocalVerb = defineVerb({
    path: ["deps", "publish-local"],
    summary: "build the packages changed here (or --package) and publish each to a registry on this machine (127.0.0.1 only) under the version committed in git (refused when npm serves that version with other content), for starci deps install-local; dry until --execute",
    editions: ["lite", "full"],
    effect: "host",
    roles: WRITERS,
    schema: "starci/deps-publish-local@3",
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
        const asked: PlanQuestions = { served: (name, version) => npmCopy(root, name, version), listed: live ? (name) => registryVersions(name, port, root) : undefined }
        const rows = await inOrder(chosen, (pkg) => planOne(root, pkg, asked))
        const order = await globalOrder(root)
        const due = rows.toSorted((left, right) => order.indexOf(left.dir) - order.indexOf(right.dir))
        const published: string[] = []
        if (flags.execute) await publishDue(context, port, { root, all, order, rows: due, published })
        const data: PublishLocalData = { mode: flags.execute ? "publish" : "plan", registry: registryUrl(port), registryState: flags.execute ? "up" : state, rows: due.map((row) => ({ package: row.package, version: row.version, dir: row.dir, npm: row.npm, replaces: row.replaces })), published }
        const table = formatTable([["PACKAGE", "VERSION", "NPM", "LOCAL REGISTRY"], ...due.map((row) => [row.package, row.version, row.npm, row.replaces === undefined ? "unknown (down)" : row.replaces ? "replaces its copy" : "new"])])
        const summary = flags.execute ? `published ${String(published.length)} package(s) to ${registryUrl(port)}` : `${String(due.length)} to publish to ${registryUrl(port)} (registry ${state}; plan only, add --execute)`
        const names = due.map((row) => row.package.replace(/^@starci\//, "")).join(" ")
        return { data, message: [table, summary, `install them in an app: starci deps install-local ${names} --execute (before a commit: starci deps install-local --restore)`].join("\n") }
    },
})
