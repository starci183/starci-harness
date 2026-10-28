import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { inOrder } from "../../harness/sequential.js"
import { Refusal, UsageError } from "../../shared/errors.js"
import { captureNpm } from "../../shared/exec.js"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb, WRITERS } from "../../shared/verb.js"
import {
    assertNpm,
    buildPackage,
    clearRecord,
    copyLocal,
    defaultPackagesRoot,
    installsOf,
    localPackages,
    manifestFiles,
    packageName,
    readRecord,
    writeRecord,
    workingPins,
} from "./packages.js"
import type { Copied, Install, LocalRecord, Pin } from "./packages.js"

/** One `@starci` package of the app as it is installed now. */
interface PackageState {
    readonly name: string
    readonly mode: "local" | "npm" | "missing"
    readonly pinned: readonly string[]
    readonly installs: readonly Install[]
    readonly recorded: string | undefined
}

interface SourceData {
    readonly root: string
    readonly action: "status" | "local" | "npm"
    readonly packages: readonly PackageState[]
    readonly copied: readonly Copied[]
    readonly warnings: readonly string[]
    readonly record: string | undefined
}

const modeOf = (installs: readonly Install[]): PackageState["mode"] => {
    if (installs.length === 0) return "missing"
    return installs.some((install) => install.local !== undefined) ? "local" : "npm"
}

const statesOf = async (root: string, pins: readonly Pin[], record: LocalRecord | undefined): Promise<PackageState[]> => {
    const manifests = await manifestFiles(root)
    const names = [...new Set([...pins.map((pin) => pin.name), ...(record?.packages.map((entry) => entry.name) ?? [])])].sort((left, right) => left.localeCompare(right))
    return names.map((name) => {
        const installs = installsOf(root, manifests, [name])
        return {
            name,
            mode: modeOf(installs),
            pinned: [...new Set(pins.filter((pin) => pin.name === name).map((pin) => pin.spec))],
            installs,
            recorded: record?.packages.find((entry) => entry.name === name)?.folder,
        }
    })
}

const describeState = (state: PackageState): string => {
    const local = state.installs.find((install) => install.local !== undefined)?.local
    const where = state.installs.map((install) => `${install.dir}@${install.version ?? "?"}`).join(", ") || "not installed"
    const from = local === undefined ? "" : ` from ${local.folder}`
    const drift = state.recorded !== undefined && state.mode !== "local" ? ` (recorded local from ${state.recorded}, but the install is npm: run --local again or --npm)` : ""
    return `${state.mode.padEnd(7)} ${state.name} pinned ${state.pinned.join(" | ") || "nowhere"}; installed ${where}${from}${drift}`
}

const npmCi = async (root: string): Promise<void> => {
    const run = await captureNpm(["ci", "--no-audit", "--no-fund"], root)
    if (run.exitCode !== 0) throw new Refusal("DEPS_INSTALL_FAILED", `npm ci in ${root} failed:\n${[run.stdout, run.stderr].join("\n").trim().split("\n").slice(-15).join("\n")}`)
}

/**
 * `starci deps source`: where the app's `@starci` packages come from. With no flag it prints each package's mode; `--local`
 * builds each named package (every pinned one the folder holds by default) in `--from` (default the harness's
 * `packages/`) and copies its publishable files over the app's installed copies; `--npm` runs `npm ci` and clears the
 * record. The mechanism and why it never touches package.json or package-lock.json is the doc comment of `./packages.ts`.
 */
export const depsSourceVerb = defineVerb({
    path: ["deps", "source"],
    summary: "print, or switch, where the app's @starci packages come from: npm (committed pins, what CI installs) or a local package folder (built and copied into node_modules only)",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/deps-source@1",
    flags: {
        local: { kind: "boolean", summary: "build each package in its folder and copy it over the app's installed copies; the committed pins stay npm versions" },
        npm: { kind: "boolean", summary: "restore pure npm resolution: npm ci, and clear the local record" },
        package: { kind: "list", summary: "with --local, the package to take locally (grammar or @starci/grammar), repeatable; default every pinned @starci package the folder holds" },
        from: { kind: "string", summary: "with --local, the folder holding the @starci package folders (default packages/ of this harness)" },
        prebuilt: { kind: "boolean", summary: "with --local, copy each package's dist as it stands instead of building it first" },
    },
    run: async (context, flags) => {
        if (flags.local && flags.npm) throw new UsageError("--local and --npm are two modes; pass one")
        if (!flags.local && (flags.package.length > 0 || flags.from !== undefined || flags.prebuilt)) throw new UsageError("--package, --from and --prebuilt go with --local")
        const root = await repositoryRoot(context.cwd)
        const pins = await workingPins(root)
        const warnings: string[] = []
        let copied: Copied[] = []
        let action: SourceData["action"] = "status"
        if (flags.npm) {
            action = "npm"
            assertNpm(root)
            await npmCi(root)
            clearRecord(root)
        } else if (flags.local) {
            action = "local"
            assertNpm(root)
            const from = resolve(flags.from ?? defaultPackagesRoot())
            const available = localPackages(from)
            const pinnedNames = [...new Set(pins.map((pin) => pin.name))]
            const wanted = flags.package.length > 0 ? flags.package.map(packageName) : pinnedNames.filter((name) => available.has(name))
            const unknown = wanted.filter((name) => !available.has(name))
            if (unknown.length > 0) throw new Refusal("DEPS_PACKAGE_UNKNOWN", `${from} holds no folder for ${unknown.join(", ")}; it holds ${[...available.keys()].join(", ") || "no @starci package"}`)
            if (wanted.length === 0) throw new Refusal("DEPS_PACKAGE_UNKNOWN", `the app pins no @starci package that ${from} holds`)
            if (!existsSync(join(root, "node_modules"))) await npmCi(root)
            const chosen = wanted.flatMap((name) => {
                const pkg = available.get(name)
                return pkg === undefined ? [] : [pkg]
            })
            if (!flags.prebuilt) {
                await inOrder(chosen, (pkg) => {
                    context.progress(`building ${pkg.name} in ${pkg.folder}`)
                    return buildPackage(pkg)
                })
            }
            const manifests = await manifestFiles(root)
            copied = await inOrder(chosen, (pkg) => copyLocal(root, manifests, pkg))
            for (const one of copied) {
                warnings.push(...one.warnings)
                const differing = pins.filter((pin) => pin.name === one.name && pin.spec !== one.version)
                if (differing.length > 0) warnings.push(`${one.name}: the local folder is ${one.version}, the app pins ${differing.map((pin) => `${pin.spec} (${pin.file})`).join(", ")}; a push is refused DEPS_LOCAL_AHEAD while the copy holds code no published version does`)
            }
            const kept = (readRecord(root)?.packages ?? []).filter((entry) => !copied.some((one) => one.name === entry.name))
            writeRecord(root, [...kept, ...copied.map((one) => ({ name: one.name, folder: one.folder }))])
        }
        const record = readRecord(root)
        const packages = await statesOf(root, pins, record)
        const data: SourceData = { root, action, packages, copied, warnings, record: record === undefined ? undefined : "local" }
        const message = [
            ...copied.map((one) => `copied ${one.name} ${one.version} from ${one.folder} into ${one.targets.join(", ")} (${String(one.files)} files)`),
            ...(action === "npm" ? ["npm ci done; every @starci package resolves from npm"] : []),
            ...packages.map(describeState),
            ...warnings.map((warning) => `warning: ${warning}`),
        ]
        return { data, message: message.join("\n") }
    },
})
