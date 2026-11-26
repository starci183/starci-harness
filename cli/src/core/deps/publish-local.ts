import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
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
import { ensureRegistry, LOCAL_TAG, PORT, registryFlags, registryPeerLine, registryState, registryUrl, registryVersions, writePublishNpmrc } from "./local-registry.js"
import { npmCopy } from "./npm-copy.js"
import type { NpmCopy } from "./npm-copy.js"
import { appBuildOrder, appPackages, declaredPublishes, PUBLISHES_KEY } from "./app-publishes.js"
import { buildPackage, parseManifest, tail } from "./packages.js"
import { judgePeerLine } from "./peer-line.js"
import type { ListedLine, PeerLineVerdict } from "./peer-line.js"
import { packStamped, sourceDigest } from "./pack-stamped.js"
import { copyPins, dataPins, movedDataPins, movedPins, pinDataEdit, pinDataRows, pinDataTexts, pinnedManifest, siblingSpecs } from "./publish-pins.js"

/** What npm serves of a version this checkout publishes: nothing, or a copy of the same source. */
type NpmState = "unserved" | "same source"

interface Row {
    readonly package: string
    readonly version: string
    readonly dir: string
    readonly npm: NpmState
    /** Whether the local registry already lists the version (a publish replaces it); undefined while the registry is down. */
    readonly replaces: boolean | undefined
    /** The sibling pins its publish copy moves (`name a -> b`): to the version published in the same batch, or to the tree's newer version the registry serves. */
    readonly pins: readonly string[]
}

/** A row with what the publish itself needs: the copy npm serves, judged again against the source as built. */
interface Planned extends Row {
    readonly served: NpmCopy | undefined
    /** The pins of its publish copy, name to exact version (publish-pins.ts copyPins). */
    readonly pinned: ReadonlyMap<string, string>
    /** The pins of the pin data its copy ships (hfs's canon-pins.yaml, publish-pins.ts dataPins), name to exact version. */
    readonly dataPinned?: ReadonlyMap<string, string>
}

interface PublishLocalData {
    readonly mode: "plan" | "publish"
    readonly registry: string
    readonly registryState: "up" | "down"
    readonly rows: readonly Row[]
    readonly published: readonly string[]
    /** The peer line of the publish (`judgePeerLine`): refused lines stop `--execute`; empty while the registry is down. */
    readonly peerLine: PeerLineVerdict
}

const CLI_DIR = "cli"

const shippable = (pkg: WorkspacePackage): boolean => !pkg.private && (pkg.relativeDir.startsWith("packages/") || pkg.relativeDir === CLI_DIR)

/**
 * Every dependency before its dependent, as CI builds them (`release affected` with no base: the build order of each package, a
 * sibling it installs or builds against first), then the CLI.
 */
export const globalOrder = async (root: string): Promise<string[]> => {
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
    return { package: pkg.name, version, dir: pkg.relativeDir, npm, replaces, served, pins: [], pinned: new Map() }
}

/**
 * The publish-copy pins of every planned row (publish-pins.ts): each sibling a row requires is pinned at its version in the same batch, and an exact pin
 * of a sibling outside the batch that the tree moved past is pinned at the tree's version when the local registry (its npm uplink included) lists it.
 * So a batch never ships the CLI requiring the hfs below the one it published beside it, and `--package cli` alone never ships behind the hfs the same tree
 * published before. `listed` is undefined while the registry is down: only the batch's own pins move then.
 */
export const pinRows = async (rows: readonly Planned[], all: readonly WorkspacePackage[], listed: ((name: string) => Promise<readonly string[]>) | undefined, dataOf: (pkg: WorkspacePackage) => readonly string[] = (pkg) => pinDataTexts(pkg.dir)): Promise<Planned[]> => {
    const batch = new Map(rows.map((row) => [row.package, row.version]))
    const tree = new Map(all.map((pkg) => [pkg.name, pkg.version]))
    const pkgOf = (row: Planned): WorkspacePackage | undefined => all.find((one) => one.relativeDir === row.dir)
    const manifests = new Map(rows.map((row) => {
        const pkg = pkgOf(row)
        const raw: unknown = pkg === undefined ? {} : JSON.parse(readFileSync(join(pkg.dir, "package.json"), "utf8"))
        return [row.package, typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {}]
    }))
    // The pin data a row's copy ships (hfs's canon-pins.yaml): its rows are pinned by the same rule as the manifest's requirements.
    const data = new Map(rows.map((row) => {
        const pkg = pkgOf(row)
        return [row.package, pkg === undefined ? [] : dataOf(pkg)]
    }))
    const named = [...manifests.values()].flatMap((manifest) => [...siblingSpecs(manifest).keys()])
    const rowed = [...data.values()].flat().flatMap((text) => pinDataRows(text).map((one) => one.name))
    const asked = [...new Set([...named, ...rowed])].filter((name) => tree.has(name) && !batch.has(name))
    const lists = new Map(listed === undefined ? [] : await inOrder(asked, async (name) => [name, await listed(name)] as const))
    const served = (name: string, version: string): boolean => lists.get(name)?.includes(version) ?? false
    return rows.map((row) => {
        const manifest = manifests.get(row.package) ?? {}
        const pinned = copyPins(manifest, batch, tree, served)
        const texts = data.get(row.package) ?? []
        const dataPinned = new Map(texts.flatMap((text) => [...dataPins(text, batch, tree, served)]))
        return { ...row, pinned, dataPinned, pins: [...movedPins(manifest, pinned, false), ...texts.flatMap((text) => movedDataPins(text, dataPinned))] }
    })
}

/**
 * The one publish of a packed tarball to the local registry, under the `local` tag and a build slot, read back before it counts: both
 * `deps publish-local` (publishOne) and the dev line (publish-dev.ts) publish through it, so the command and its confirmation live once.
 */
export const publishLocalTarball = async (given: { readonly tarball: string; readonly dir: string; readonly name: string; readonly version: string; readonly port: number; readonly npmrc: string; readonly scratch: string }): Promise<void> => {
    const { tarball, dir, name, version, port, npmrc, scratch } = given
    const published = await withHeavySlot("build", `npm publish ${name}@${version}`, dir, {}, (held) => captureNpm(["publish", tarball, "--tag", LOCAL_TAG, "--provenance=false", "--userconfig", npmrc, ...registryFlags(port)], scratch, held.options))
    if (published.exitCode !== 0) throw stepFailed(`npm publish of ${name}@${version} to ${registryUrl(port)}`, published)
    const view = await captureNpm(["view", `${name}@${version}`, "version", ...registryFlags(port)], scratch)
    if (view.exitCode !== 0 || view.stdout.trim() !== version) throw new Refusal("PUBLISH_NOT_CONFIRMED", `${name}@${version} is not readable from ${registryUrl(port)} after publishing`)
}

/** Packs the package folder with its source digest stamped and publishes the tarball to the local registry as it is: the version in git, replacing the copy of that version the registry lists (an unpublish, then the publish). */
const publishOne = async (given: { readonly pkg: WorkspacePackage; readonly root: string; readonly row: Planned; readonly port: number; readonly npmrc: string }): Promise<void> => {
    const { pkg, root, row, port, npmrc } = given
    const scratch = mkdtempSync(join(tmpdir(), "starci-publish-local-"))
    try {
        judgeVersion(row.package, row.version, await sourceDigest(root, pkg.relativeDir), row.served)
        // The copy pins its siblings as the batch publishes them (publish-pins.ts): an exact pin moves, a range a release satisfies stays.
        const local = await packStamped({ pkg, root, scratch, name: `${row.version}.tgz`, edit: (text) => pinnedManifest(text, undefined, row.pinned, false), entries: pinDataEdit(() => row.dataPinned ?? new Map<string, string>(), false) })
        if ((await registryVersions(row.package, port, scratch)).includes(row.version)) {
            const removed = await captureNpm(["unpublish", `${row.package}@${row.version}`, "--force", "--userconfig", npmrc, ...registryFlags(port)], scratch)
            if (removed.exitCode !== 0) throw stepFailed(`npm unpublish of ${row.package}@${row.version} from ${registryUrl(port)}`, removed)
        }
        await publishLocalTarball({ tarball: local, dir: pkg.dir, name: row.package, version: row.version, port, npmrc, scratch })
    } finally {
        rmSync(scratch, { recursive: true, force: true })
    }
}

/**
 * Builds an app's declared package: the app installed its workspace once at its root (a member has no node_modules of its own, so nothing is installed here),
 * then `npm run build` in the member's folder.
 */
const buildAppPackage = async (root: string, pkg: WorkspacePackage): Promise<void> => {
    if (pkg.scripts.build === undefined) return
    if (!existsSync(join(root, "node_modules"))) throw new Refusal("PUBLISH_LOCAL_NOT_INSTALLED", `${root} has no node_modules: run npm ci at the app root before publishing ${pkg.name}`)
    const build = await withHeavySlot("build", `npm run build ${pkg.name}`, pkg.dir, {}, (held) => captureNpm(["run", "build"], pkg.dir, held.options))
    if (build.exitCode !== 0) throw stepFailed(`npm run build in ${pkg.dir}`, build)
}

/** Builds what the rows need and publishes them in order to the local registry; an app (`app`) builds only its declared packages, in their dependency order. */
const publishDue = async (context: VerbContext, port: number, given: { readonly root: string; readonly all: readonly WorkspacePackage[]; readonly order: readonly string[]; readonly rows: readonly Planned[]; readonly published: string[]; readonly app: boolean }): Promise<void> => {
    const { root, all, order, rows, published, app } = given
    const npmrc = writePublishNpmrc(port)
    const plan = app ? undefined : await affectedBy(root, undefined, undefined)
    const needed = new Set(rows.flatMap((row) => (row.dir === CLI_DIR ? [CLI_DIR] : (plan?.packages.find((one) => one.dir === row.dir)?.build ?? [row.dir]))))
    await inOrder(
        order.filter((dir) => needed.has(dir)),
        async (dir) => {
            const pkg = all.find((one) => one.relativeDir === dir)
            if (pkg === undefined) return
            context.progress(`building ${pkg.name} in ${pkg.dir}`)
            if (app) await buildAppPackage(root, pkg)
            else await buildPackage({ name: pkg.name, folder: pkg.dir, version: pkg.version, builds: pkg.scripts.build !== undefined })
            const row = rows.find((one) => one.dir === dir)
            if (row === undefined) return
            context.progress(`publishing ${row.package}@${row.version} to ${registryUrl(port)}`)
            await publishOne({ pkg, root, row, port, npmrc })
            published.push(`${row.package}@${row.version}`)
        },
    )
}

/**
 * The peer line of the due rows against what the local registry lists of every workspace package (CONTRIB-20; contexts/authority/packages.md "The local registry"): a published version
 * no sibling release can install beside is refused, a published range that excludes the newest line the registry lists is warned.
 */
const peerLineOf = async (all: readonly WorkspacePackage[], rows: readonly Row[], port: number): Promise<PeerLineVerdict> => {
    const shipped = all.filter(shippable)
    const names = new Set(shipped.map((pkg) => pkg.name))
    const peerers = Object.fromEntries(shipped.filter((pkg) => Object.keys(pkg.peers).some((name) => names.has(name))).map((pkg) => [pkg.name, pkg.peers]))
    const due = rows.map((row) => ({ package: row.package, version: row.version, peers: all.find((pkg) => pkg.name === row.package)?.peers ?? {} }))
    const wanted = [...new Set([...Object.keys(peerers), ...due.flatMap((row) => Object.keys(row.peers))])].filter((name) => names.has(name))
    const listings = new Map<string, ListedLine>(await Promise.all(wanted.map(async (name) => [name, await registryPeerLine(name, port)] as const)))
    return judgePeerLine(due, peerers, (name) => listings.get(name))
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
 * reaches npm, and no committed file changes. An app (a repository whose hfs.json declares `publishes`) publishes exactly the workspace
 * package folders it declares there, under the same rules; a package it does not declare is refused PUBLISH_LOCAL_UNDECLARED, and a repository
 * that is neither a harness checkout nor declares `publishes` PUBLISH_LOCAL_NOT_HARNESS.
 */
export const depsPublishLocalVerb = defineVerb({
    path: ["deps", "publish-local"],
    summary: "build the packages changed here (or --package) and publish each to a registry on this machine (127.0.0.1 only) under the version committed in git (refused when npm serves that version with other content), for starci deps install-local; an app whose hfs.json declares publishes publishes exactly the package folders it declares; dry until --execute",
    effect: "host",
    roles: WRITERS,
    schema: "starci/deps-publish-local@4",
    flags: {
        execute: { kind: "boolean", summary: "start or reuse the registry container, build and publish (default: print the plan only)" },
        package: { kind: "list", summary: "this package (its folder or name), repeatable, instead of the packages changed since the base of the branch (an app: one of its declared packages); its build prerequisites are built, not published" },
        cwd: { kind: "string", summary: "the harness checkout, or the app that declares hfs.json publishes, to build and publish (default: the checkout of the working directory)" },
    },
    run: async (context, flags) => {
        const port = PORT
        const root = await repositoryRoot(resolve(flags.cwd ?? context.cwd))
        const harness = isHarnessCheckout(root)
        const declared = harness ? undefined : declaredPublishes(root)
        if (!harness && declared === undefined) throw new Refusal("PUBLISH_LOCAL_NOT_HARNESS", `${root} is not a harness checkout (cli/, contexts/ and packages/) and its hfs.json declares no "${PUBLISHES_KEY}" (the workspace package folders an app puts on the local registry); declare them or pass --cwd <harness checkout>`)
        const all = listPackages(root)
        const chosen = declared === undefined ? await chosenPackages(root, all, flags.package) : appPackages(all, declared, flags.package)
        if (flags.execute) await ensureRegistry(root)
        const state = await registryState()
        const live = state === "up"
        const asked: PlanQuestions = { served: (name, version) => npmCopy(root, name, version), listed: live ? (name) => registryVersions(name, port, root) : undefined }
        const rows = await pinRows(await inOrder(chosen, (pkg) => planOne(root, pkg, asked)), all.filter(shippable), asked.listed)
        const order = declared === undefined ? await globalOrder(root) : appBuildOrder(chosen)
        const due = rows.toSorted((left, right) => order.indexOf(left.dir) - order.indexOf(right.dir))
        const peerLine: PeerLineVerdict = declared === undefined && (live || flags.execute) ? await peerLineOf(all, due, port) : { refused: [], warned: [] }
        if (flags.execute && peerLine.refused.length > 0) throw new Refusal("PUBLISH_LOCAL_PEER_ORPHAN", `an app could not install this publish beside its siblings (CONTRIB-20; contexts/authority/packages.md "The local registry"):\n${peerLine.refused.map((line) => `- ${line}`).join("\n")}`)
        const published: string[] = []
        if (flags.execute) await publishDue(context, port, { root, all, order, rows: due, published, app: declared !== undefined })
        const data: PublishLocalData = { mode: flags.execute ? "publish" : "plan", registry: registryUrl(port), registryState: flags.execute ? "up" : state, rows: due.map((row) => ({ package: row.package, version: row.version, dir: row.dir, npm: row.npm, replaces: row.replaces, pins: row.pins })), published, peerLine }
        const table = formatTable([["PACKAGE", "VERSION", "NPM", "LOCAL REGISTRY"], ...due.map((row) => [row.package, row.version, row.npm, row.replaces === undefined ? "unknown (down)" : row.replaces ? "replaces its copy" : "new"])])
        const summary = flags.execute ? `published ${String(published.length)} package(s) to ${registryUrl(port)}` : `${String(due.length)} to publish to ${registryUrl(port)} (registry ${state}; plan only, add --execute)`
        const names = due.map((row) => row.package.replace(/^@starci\//, "")).join(" ")
        const pinLines = due.filter((row) => row.pins.length > 0).map((row) => `${row.package} publish copy pins ${row.pins.join(", ")}`)
        const peerLines = [...pinLines, ...peerLine.refused.map((line) => `refused PUBLISH_LOCAL_PEER_ORPHAN: ${line}`), ...peerLine.warned.map((line) => `warning PUBLISH_LOCAL_PEER_LINE: ${line}`)]
        return { data, message: [table, ...peerLines, summary, `install them in an app: starci deps install-local ${names} --execute (before a commit: starci deps install-local --restore)`].join("\n") }
    },
})
