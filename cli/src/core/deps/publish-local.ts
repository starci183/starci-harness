import { resolve } from "node:path"
import { inOrder } from "../../harness/sequential.js"
import { withHeavySlot } from "../../harness/heavy.js"
import { Refusal, UsageError } from "../../shared/errors.js"
import { captureNpm } from "../../shared/exec.js"
import { repositoryRoot, trackedChanges } from "../../shared/git.js"
import { formatTable } from "../../shared/output.js"
import { defineVerb, WRITERS } from "../../shared/verb.js"
import type { VerbContext } from "../../shared/verb.js"
import { listPackages } from "../../shared/workspace.js"
import type { WorkspacePackage } from "../../shared/workspace.js"
import { affectedBy } from "../release/affected.js"
import { distTagOf, judgePlan } from "../release/publish.js"
import { isHarnessCheckout } from "../release/push-gate.js"
import { DEFAULT_PORT, ensureRegistry, installFlags, registryAnswers, registryFlags, registryStatus, registryUrl, writeNpmrcs } from "./local-registry.js"
import { buildPackage } from "./packages.js"

/** What the local registry does with one package: publish it, find it there already, find npm serving it, or replace it (`--force`). */
type Action = "publish" | "in-registry" | "on-npm" | "republish"

interface Row {
    readonly package: string
    readonly version: string
    readonly dir: string
    readonly distTag: string
    readonly action: Action
}

interface PublishLocalData {
    readonly mode: "plan" | "publish"
    readonly registry: string
    readonly registryState: "absent" | "stopped" | "running"
    readonly rows: readonly Row[]
    readonly published: readonly string[]
    readonly installNpmrc: string | undefined
    readonly warnings: readonly string[]
}

const CLI_DIR = "cli"

const shippable = (pkg: WorkspacePackage): boolean => !pkg.private && (pkg.relativeDir.startsWith("packages/") || pkg.relativeDir === CLI_DIR)

/** Whether `name@version` is readable through the local registry (its own storage, or npm through its uplink). */
const readable = async (pkg: WorkspacePackage, port: number): Promise<boolean> => {
    const view = await captureNpm(["view", `${pkg.name}@${pkg.version}`, "version", ...registryFlags(port)], pkg.dir)
    return view.exitCode === 0 && view.stdout.trim() === pkg.version
}

/**
 * Every dependency before its dependent, as CI builds them (`release affected` with no base: the build order of each package, a
 * sibling it installs or builds against first), then the CLI.
 */
const globalOrder = async (root: string): Promise<string[]> => {
    const plan = await affectedBy(root, undefined, undefined)
    return [...new Set([...plan.packages.flatMap((one) => one.build), CLI_DIR])]
}

const stepFailed = (what: string, run: { readonly stdout: string; readonly stderr: string }): Refusal =>
    new Refusal("PUBLISH_LOCAL_FAILED", `${what} failed:\n${[run.stderr, run.stdout].join("\n").trim().split("\n").slice(-12).join("\n")}`)

/** Builds what the due rows need and publishes them in order to the local registry; the npmrc the app installs through. */
const publishDue = async (context: VerbContext, port: number, given: { readonly root: string; readonly all: ReturnType<typeof listPackages>; readonly order: readonly string[]; readonly due: readonly Row[]; readonly published: string[] }): Promise<string | undefined> => {
    const { root, all, order, due, published } = given
    let installNpmrc: string | undefined
    if (due.length === 0) context.progress("nothing to publish")
    const files = writeNpmrcs(port)
    installNpmrc = files.install
    const plan = await affectedBy(root, undefined, undefined)
    const needed = new Set(due.flatMap((row) => (row.dir === CLI_DIR ? [CLI_DIR] : (plan.packages.find((one) => one.dir === row.dir)?.build ?? [row.dir]))))
    const builds = order.filter((dir) => needed.has(dir))
    await inOrder(builds, async (dir) => {
        const pkg = all.find((one) => one.relativeDir === dir)
        if (pkg === undefined) return
        context.progress(`building ${pkg.name} in ${pkg.dir}`)
        await buildPackage({ name: pkg.name, folder: pkg.dir, version: pkg.version, builds: pkg.scripts.build !== undefined })
        const row = due.find((one) => one.dir === dir)
        if (row === undefined) return
        const pkgNpm = ["--userconfig", files.publish, ...registryFlags(port)]
        if (row.action === "republish") {
            const gone = await withHeavySlot("build", `npm unpublish ${row.package}`, pkg.dir, {}, (held) => captureNpm(["unpublish", `${row.package}@${row.version}`, "--force", ...pkgNpm], pkg.dir, held.options))
            if (gone.exitCode !== 0) throw stepFailed(`npm unpublish ${row.package}@${row.version} from ${registryUrl(port)}`, gone)
        }
        context.progress(`publishing ${row.package}@${row.version} to ${registryUrl(port)}`)
        const run = await withHeavySlot("build", `npm publish ${row.package}`, pkg.dir, {}, (held) => captureNpm(["publish", "--tag", row.distTag, "--provenance=false", ...pkgNpm], pkg.dir, held.options))
        if (run.exitCode !== 0) throw stepFailed(`npm publish of ${row.package}@${row.version} to ${registryUrl(port)}`, run)
        if (!(await readable(pkg, port))) throw new Refusal("PUBLISH_NOT_CONFIRMED", `${row.package}@${row.version} is not readable from ${registryUrl(port)} after publishing`)
        published.push(`${row.package}@${row.version}`)
    })
    return installNpmrc
}

/**
 * `starci deps publish-local`: builds the harness's packages and the CLI and publishes them to an npm registry on this machine, so
 * an app installs them like real npm with no worktree and no copy into node_modules. Dry until `--execute`. A version is
 * published once: one already in the registry is kept (`--force` unpublishes and republishes it), and one npm already serves is
 * left to npm (Verdaccio never serves a local copy over it, so a package edited under a version npm has is `on-npm` until its
 * version is raised, the rule of a package edit). It is not a release: nothing reaches npm, and no committed file changes.
 */
export const depsPublishLocalVerb = defineVerb({
    path: ["deps", "publish-local"],
    summary: "build the harness packages and the CLI and publish the versions npm lacks to a registry on this machine (127.0.0.1 only), for an app to install like npm; dry until --execute",
    editions: ["lite", "full"],
    effect: "host",
    roles: WRITERS,
    schema: "starci/deps-publish-local@1",
    flags: {
        execute: { kind: "boolean", summary: "start or reuse the registry container, build and publish (default: print the plan only)" },
        package: { kind: "list", summary: "only this package (its folder or name), repeatable; its build prerequisites are built, not published" },
        force: { kind: "boolean", summary: "replace a version in the local registry; existing app locks and npm caches retain the old tarball (prefer a new version)" },
        port: { kind: "string", summary: `the port on 127.0.0.1 (default ${String(DEFAULT_PORT)})` },
        cwd: { kind: "string", summary: "the harness checkout to build and publish (default: the checkout of the working directory)" },
    },
    run: async (context, flags) => {
        const port = flags.port === undefined ? DEFAULT_PORT : Number(flags.port)
        if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new UsageError("--port is a number from 1024 to 65535")
        const root = await repositoryRoot(resolve(flags.cwd ?? context.cwd))
        if (!isHarnessCheckout(root)) throw new Refusal("PUBLISH_LOCAL_NOT_HARNESS", `${root} is not a harness checkout (cli/, contexts/ and packages/); pass --cwd <harness checkout>`)
        const all = listPackages(root)
        const chosen = all.filter(shippable).filter((pkg) => flags.package.length === 0 || flags.package.some((one) => pkg.relativeDir === one || pkg.name === one || pkg.relativeDir === `packages/${one}`))
        if (chosen.length === 0) throw new Refusal("RELEASE_PACKAGE_UNKNOWN", `no publishable package matches ${flags.package.join(", ") || "this checkout"}`)
        // The release plan's own judgement against npm (never the local registry): a sibling requirement that skews, and a package whose shipped files changed under a version npm has.
        const npm = await judgePlan(root, all, "")
        // A stopped registry can already hold these versions; plan only once its storage is readable for an executed run.
        if (flags.execute) await ensureRegistry(port, root)
        const state = await registryStatus(port, root)
        const live = state === "running" && (await registryAnswers(port))
        const warnings: string[] = []
        const rows = await inOrder(chosen, async (pkg): Promise<Row> => {
            const base = { package: pkg.name, version: pkg.version, dir: pkg.relativeDir, distTag: distTagOf(pkg.version) }
            if (npm.find((row) => row.package === pkg.name)?.action === "published") return { ...base, action: "on-npm" }
            if (!live || !(await readable(pkg, port))) return { ...base, action: "publish" }
            return { ...base, action: flags.force ? "republish" : "in-registry" }
        })
        const dirty = await trackedChanges(root)
        for (const row of rows.filter((one) => one.action === "on-npm")) {
            const edited = dirty.filter((file) => file.startsWith(`${row.dir}/`))
            if (edited.length > 0) warnings.push(`${row.package}@${row.version} is on npm and ${edited.slice(0, 3).join(", ")} changed here: the registry serves npm's copy; raise its version (and CHANGELOG) to publish your edit`)
        }
        const order = await globalOrder(root)
        const due = rows.filter((row) => row.action === "publish" || row.action === "republish").toSorted((left, right) => order.indexOf(left.dir) - order.indexOf(right.dir))
        const published: string[] = []
        let installNpmrc: string | undefined
        if (flags.execute) {
            installNpmrc = await publishDue(context, port, { root, all, order, due, published })
        }
        const shownRegistry = flags.execute ? "running" : state
        const data: PublishLocalData = { mode: flags.execute ? "publish" : "plan", registry: registryUrl(port), registryState: shownRegistry, rows, published, installNpmrc, warnings }
        const table = formatTable([["PACKAGE", "VERSION", "TAG", "ACTION"], ...rows.map((row) => [row.package, row.version, row.distTag, row.action])])
        const summary = flags.execute ? `published ${String(published.length)} package(s) to ${registryUrl(port)}` : `${String(due.length)} to publish to ${registryUrl(port)} (registry ${state}; plan only, add --execute)`
        const install = [
            "install in an app (this one command; nothing is written to the app's .npmrc or committed):",
            `  npm install @starci/<package>@<version> ${installFlags(port).join(" ")}`,
            ...(installNpmrc === undefined ? [] : [`  or NPM_CONFIG_USERCONFIG=${installNpmrc} npm install`]),
            "when switching from deps source --local, first run deps source --npm in the app to clear its recorded overlay, then install from this registry",
            ...(flags.force ? ["--force changes tarball integrity: existing locks and caches retain the old build. Prefer a new version; verify a replacement in a fresh scratch app with no prior lockfile/node_modules and a fresh npm --cache folder"] : []),
            "back to npm: git checkout -- package.json package-lock.json, then starci deps source --npm; a lockfile naming 127.0.0.1 is refused DEPS_LOCAL_REGISTRY_COMMITTED",
        ]
        return { data, message: [table, summary, ...warnings.map((warning) => `warning: ${warning}`), ...install].join("\n") }
    },
})
