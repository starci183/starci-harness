import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { toolCacheDir } from "@starci/hfs/tool-cache"
import { dirname, join, posix } from "node:path"
import { z } from "zod"
import { Refusal, UsageError } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { defineVerb, WRITERS } from "../../shared/verb.js"
import { integrityMismatches } from "./lock-integrity.js"
import { localReferences, NPMJS_FLAGS } from "./local-refs.js"
import { lockedHere, lockedPackages, withoutLocked } from "./lockfile.js"
import { installFlags, latestLocal, PORT, registryAnswers, registryUrl, registryVersions } from "./local-registry.js"
import { npmCopy } from "./npm-copy.js"
import { appNpm, assertNpm, manifestFiles, packageName, readManifest, workingPins } from "./packages.js"

/** The file an app's install of local packages is recorded in: the untracked tool cache of this checkout (slot `app.tool-cache`, beside the check journal), since the pins it changed are this checkout's files and a lite app holds no `.starciwork`. */
export const installRecordFile = (root: string): string => join(toolCacheDir(root), "install-local.json")

const recordSchema = z.object({
    schema: z.literal("starci/deps-install-local@1"),
    registry: z.string(),
    packages: z.array(
        z.object({
            name: z.string(),
            version: z.string(),
            /** Each requirement the install replaced: its manifest, field and original spec (null: the entry did not exist and the install added it). */
            pins: z.array(z.object({ file: z.string(), field: z.string(), spec: z.string().nullable() })),
        }),
    ),
})

/** What `deps install-local` recorded: each package at its local version and the requirements it replaced. */
export type InstallRecord = z.infer<typeof recordSchema>

/** One package asked for: its name and, when given, the exact version of the registry. */
export interface Requested {
    readonly name: string
    readonly version: string | undefined
}

/** A package argument (`grammar`, `@starci/grammar`, either `@<version>`) as a name and an optional version. */
export const parseRequested = (argument: string): Requested => {
    const at = argument.lastIndexOf("@")
    if (at <= 0) return { name: packageName(argument), version: undefined }
    const version = argument.slice(at + 1)
    return { name: packageName(argument.slice(0, at)), version: version === "" ? undefined : version }
}

/** The version to install for each requested package: the one named (the registry must list it), or the one `deps publish-local` published last; refuses INSTALL_LOCAL_NONE when the registry holds none. */
const versionsFor = async (root: string, requested: readonly Requested[], port: number): Promise<{ readonly name: string; readonly version: string }[]> => {
    const resolved: { name: string; version: string }[] = []
    for (const one of requested) {
        if (one.version !== undefined) {
            if (!(await registryVersions(one.name, port, root)).includes(one.version)) throw new Refusal("INSTALL_LOCAL_NONE", `${registryUrl(port)} holds no ${one.name}@${one.version}; starci deps publish-local --execute --package ${one.name} publishes one`)
            resolved.push({ name: one.name, version: one.version })
            continue
        }
        const latest = await latestLocal(one.name, port, root)
        if (latest === undefined) throw new Refusal("INSTALL_LOCAL_NONE", `${registryUrl(port)} holds no local publish of ${one.name}; run starci deps publish-local --execute --package ${one.name} in the harness checkout first`)
        resolved.push({ name: one.name, version: latest })
    }
    return resolved
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** A manifest's text with one requirement set (spec) or removed (null), in the file's own indent and line ending; an emptied `overrides` goes with it. */
export const withPin = (text: string, field: string, name: string, spec: string | null): string => {
    const bare = text.codePointAt(0) === 0xfeff ? text.slice(1) : text
    const parsed: unknown = JSON.parse(bare)
    if (!isRecord(parsed)) throw new Refusal("DEPS_MANIFEST_UNREADABLE", "a package.json holds a JSON object")
    const manifest = { ...parsed }
    const current = manifest[field]
    const table: Record<string, unknown> = isRecord(current) ? { ...current } : {}
    if (spec === null) Reflect.deleteProperty(table, name)
    else table[name] = spec
    if (spec === null && Object.keys(table).length === 0) Reflect.deleteProperty(manifest, field)
    else manifest[field] = table
    const indent = /^([ \t]+)"/m.exec(bare)?.[1] ?? "  "
    const eol = bare.includes("\r\n") ? "\r\n" : "\n"
    const written = JSON.stringify(manifest, null, indent).replaceAll("\n", eol)
    return `${written}${/\r?\n$/.test(bare) ? eol : ""}`
}

/** The checkout's install record, or undefined when nothing is installed locally. */
export const readInstallRecord = (root: string): InstallRecord | undefined => {
    const file = installRecordFile(root)
    if (!existsSync(file)) return undefined
    let raw: unknown
    try {
        raw = JSON.parse(readFileSync(file, "utf8"))
    } catch {
        raw = undefined
    }
    const parsed = recordSchema.safeParse(raw)
    if (!parsed.success) throw new Refusal("INSTALL_LOCAL_RECORD_UNREADABLE", `${file} is not a starci/deps-install-local@1 record; delete it and restore the pins by hand (git checkout -- package.json package-lock.json)`)
    return parsed.data
}

/** Writes the checkout's install record into the tool cache. */
export const writeInstallRecord = (root: string, record: InstallRecord): void => {
    const file = installRecordFile(root)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`)
}

const LOCKFILE_NAME = "package-lock.json"

/** The lockfile of an install unit: its folder's package-lock.json, as a repository path. */
const lockPath = (folder: string): string => (folder === "" ? LOCKFILE_NAME : posix.join(folder, LOCKFILE_NAME))

/**
 * The install unit a manifest belongs to: the nearest folder at or above it (a repository path, "" for the root) that holds a
 * package-lock.json. The root and its workspaces share the root's lockfile; a package in a subfolder with a lockfile of its own (a
 * separate npm package, not a workspace) is installed alone in its folder, with its own lockfile.
 */
export const installUnitOf = (root: string, file: string): string => {
    let folder = posix.dirname(file)
    for (;;) {
        const here = folder === "." ? "" : folder
        if (here === "" || existsSync(join(root, here, LOCKFILE_NAME))) return here
        folder = posix.dirname(here)
    }
}

/** One install unit an install or a restore runs npm in: its folder and the packages whose pins it owns. */
export interface InstallUnit {
    readonly folder: string
    readonly names: readonly string[]
}

/** The units of a set of pin sites, each with the names it pins, the root first. */
const unitsOf = (root: string, sites: readonly { readonly file: string; readonly name: string }[]): InstallUnit[] => {
    const byFolder = new Map<string, Set<string>>()
    for (const site of sites) {
        const folder = installUnitOf(root, site.file)
        byFolder.set(folder, (byFolder.get(folder) ?? new Set()).add(site.name))
    }
    return [...byFolder].map(([folder, names]) => ({ folder, names: [...names].toSorted((left, right) => left.localeCompare(right)) })).toSorted((left, right) => left.folder.localeCompare(right.folder))
}

/** The edits of one install: each manifest's new text, the requirements it replaced, and the units npm installs in. */
export interface InstallPlan {
    readonly texts: ReadonlyMap<string, string>
    readonly originals: ReadonlyMap<string, string>
    readonly packages: InstallRecord["packages"]
    readonly units: readonly InstallUnit[]
    /** The named packages this app neither pins nor has in its root lockfile: an `overrides` entry installs nothing, so they are left out. */
    readonly absent: readonly string[]
}

/**
 * Plans the pins of an install: every requirement of a named package in the repository's manifests is raised to its local version in the
 * manifest that holds it, and a package nothing requires but the root lockfile holds (hfs, brought in by starci-harness) gets an `overrides`
 * entry in the root manifest. A package neither pinned nor locked is not in the app's tree at all (a canon of another Grammar in the dev line):
 * an override cannot add it, so it is left out and named in `absent`.
 * Each edited manifest belongs to the install unit that owns it (`installUnitOf`). A package an earlier install already replaced keeps the
 * original specs that install recorded.
 */
export const planInstall = async (root: string, versions: readonly { readonly name: string; readonly version: string }[], before: InstallRecord | undefined): Promise<InstallPlan> => {
    const pins = await workingPins(root)
    const rootLock = join(root, "package-lock.json")
    const locked = new Set(existsSync(rootLock) ? lockedPackages(readFileSync(rootLock, "utf8"), "package-lock.json").map((one) => one.name) : [])
    const absent = versions.filter(({ name }) => !pins.some((pin) => pin.name === name) && !locked.has(name)).map(({ name }) => name)
    const texts = new Map<string, string>()
    const originals = new Map<string, string>()
    const sites: { file: string; name: string }[] = []
    const textOf = (file: string): string => texts.get(file) ?? readFileSync(join(root, file), "utf8")
    const edit = (file: string, field: string, name: string, spec: string): void => {
        if (!originals.has(file)) originals.set(file, readFileSync(join(root, file), "utf8"))
        texts.set(file, withPin(textOf(file), field, name, spec))
        sites.push({ file, name })
    }
    const packages = versions.filter(({ name }) => !absent.includes(name)).map(({ name, version }) => {
        const own = pins.filter((pin) => pin.name === name)
        const targets = own.length > 0 ? own.map((pin) => ({ file: pin.file, field: pin.field })) : [{ file: "package.json", field: "overrides" }]
        for (const site of targets) edit(site.file, site.field, name, version)
        const recorded = before?.packages.find((entry) => entry.name === name)?.pins
        const replaced = recorded ?? (own.length > 0 ? own.map((pin) => ({ file: pin.file, field: pin.field, spec: pin.spec })) : [{ file: "package.json", field: "overrides", spec: null }])
        return { name, version, pins: replaced }
    })
    return { texts, originals, packages, units: unitsOf(root, sites), absent }
}

const writeTexts = (root: string, texts: ReadonlyMap<string, string>): void => {
    for (const [file, text] of texts) writeFileSync(join(root, file), text)
}

interface InstallLocalData {
    readonly mode: "plan" | "install" | "restore"
    readonly registry: string
    readonly installed: readonly { readonly name: string; readonly version: string }[]
    readonly restored: readonly string[]
    readonly record: string | undefined
}

const RESTORE_STEP = "before a commit, put the npm pins back: starci deps install-local --restore"

/**
 * The Grammar codemod line an install suggests when it moves @starci/grammar to another version: `starci app codemod --from <the pin
 * it replaced> --to <the version installed>`, which runs every codemod in between (owner 2026-11-21: one codemod per Grammar release).
 * Printed only, never run; null when the install moves no Grammar or the replaced pin is not an x.y.z version.
 */
export const grammarCodemodHint = (packages: readonly { readonly name: string; readonly version: string; readonly pins: readonly { readonly spec: string | null }[] }[]): string | null => {
    const grammar = packages.find((one) => one.name === "@starci/grammar")
    const from = grammar?.pins.map((pin) => /^[~^=v]?(\d+\.\d+\.\d+)$/.exec(pin.spec ?? "")?.[1]).find((version) => version !== undefined)
    if (grammar === undefined || from === undefined || from === grammar.version) return null
    return `the Grammar moves ${from} -> ${grammar.version}: run its codemods with starci app codemod --from ${from} --to ${grammar.version} (dry; add --execute to write)`
}

/** Runs npm in one install unit's folder: the repository root or a subfolder package with its own lockfile. */
export type UnitNpm = (folder: string, args: readonly string[], label: string) => Promise<void>

const unitLabel = (label: string, folder: string): string => (folder === "" ? label : `${label} in ${folder}/`)

/** Every unit's lockfile as it is now, by unit folder, to put back on a failure. */
const lockTexts = (root: string, units: readonly InstallUnit[]): Map<string, string> => new Map(units.map((unit) => [unit.folder, readFileSync(join(root, lockPath(unit.folder)), "utf8")]))

/**
 * Applies an install plan: writes the pins, drops the named packages' lock entries in each unit's lockfile, runs npm install in each unit's
 * folder, and checks each unit's lockfile resolves its packages from the registry on this machine. Any failure puts every unit's manifests
 * and lockfile back as they were.
 */
export const applyInstall = async (root: string, plan: InstallPlan, port: number, npm: UnitNpm): Promise<void> => {
    const locks = lockTexts(root, plan.units)
    const rollBack = (): void => {
        writeTexts(root, plan.originals)
        for (const [folder, text] of locks) writeFileSync(join(root, lockPath(folder)), text)
    }
    writeTexts(root, plan.texts)
    for (const unit of plan.units) writeFileSync(join(root, lockPath(unit.folder)), withoutLocked(locks.get(unit.folder) ?? "", lockPath(unit.folder), (one) => unit.names.includes(one.name)).text)
    try {
        for (const unit of plan.units) await npm(join(root, unit.folder), ["install", "--no-audit", "--no-fund", "--prefer-online", ...installFlags(port, unit.names)], unitLabel("npm install of local packages", unit.folder))
    } catch (error: unknown) {
        rollBack()
        throw error
    }
    const npmServed = plan.units.flatMap((unit) => {
        const where = lockPath(unit.folder)
        const locked = lockedPackages(readFileSync(join(root, where), "utf8"), where)
        return unit.names.filter((name) => !locked.some((one) => one.name === name && lockedHere(one))).map((name) => `${name} (${where})`)
    })
    if (npmServed.length > 0) {
        rollBack()
        throw new Refusal("INSTALL_LOCAL_NOT_RESOLVED", `${npmServed.join(", ")} still resolve from npm after the install, not from ${registryUrl(port)}; the pins and the lockfiles are put back, run npm ci before anything else`)
    }
}

/** Installs the local versions into the app like npm and records the pins they replaced. */
export const installLocal = async (root: string, requested: readonly Requested[], port: number, execute: boolean, npm: UnitNpm = appNpm): Promise<{ readonly data: InstallLocalData; readonly message: string }> => {
    if (!(await registryAnswers(port))) throw new Refusal("LOCAL_REGISTRY_NOT_READY", `${registryUrl(port)} does not answer; start the local-registry service (starci host up local-registry) and publish with starci deps publish-local --execute`)
    const versions = await versionsFor(root, requested, port)
    const before = readInstallRecord(root)
    const plan = await planInstall(root, versions, before)
    const lines = versions.filter((one) => !plan.absent.includes(one.name)).map((one) => `${one.name}@${one.version}`)
    const absentLine = plan.absent.length === 0 ? [] : [`left out ${plan.absent.join(", ")}: this app neither pins it nor has it in package-lock.json, so there is nothing to install`]
    const lockfiles = plan.units.map((unit) => lockPath(unit.folder)).join(", ")
    if (!execute) {
        return { data: { mode: "plan", registry: registryUrl(port), installed: versions, restored: [], record: undefined }, message: [`would install ${lines.join(", ")} from ${registryUrl(port)} into ${lockfiles} (plan only, add --execute)`, ...absentLine, ...plan.packages.flatMap((one) => one.pins.map((pin) => `  ${pin.file} ${pin.field} ${one.name}: ${pin.spec ?? "(none)"} -> ${one.version}`)), ...[grammarCodemodHint(plan.packages)].filter((line) => line !== null)].join("\n") }
    }
    await applyInstall(root, plan, port, npm)
    const kept = (before?.packages ?? []).filter((entry) => !plan.packages.some((one) => one.name === entry.name))
    writeInstallRecord(root, { schema: "starci/deps-install-local@1", registry: registryUrl(port), packages: [...kept, ...plan.packages].toSorted((left, right) => left.name.localeCompare(right.name)) })
    return {
        data: { mode: "install", registry: registryUrl(port), installed: versions, restored: [], record: installRecordFile(root) },
        message: [`installed ${lines.join(", ")} from ${registryUrl(port)}; the pins and ${lockfiles} name them, and ${installRecordFile(root)} records what they replaced`, ...absentLine, ...[grammarCodemodHint(plan.packages)].filter((line) => line !== null), RESTORE_STEP].join("\n"),
    }
}

/** The recorded pins that still hold their local version, put back to the spec they replaced; the manifests as text. */
const revertedTexts = (root: string, record: InstallRecord): { readonly texts: Map<string, string>; readonly skipped: string[] } => {
    const texts = new Map<string, string>()
    const skipped: string[] = []
    for (const one of record.packages) {
        for (const pin of one.pins) {
            const text = texts.get(pin.file) ?? readFileSync(join(root, pin.file), "utf8")
            const table: unknown = readManifest(join(root, pin.file))[pin.field]
            const current = isRecord(table) ? table[one.name] : undefined
            if (current !== one.version) {
                skipped.push(`${pin.file} ${pin.field} ${one.name} is ${typeof current === "string" ? current : "gone"}, not ${one.version}: left as it is`)
                continue
            }
            texts.set(pin.file, withPin(text, pin.field, one.name, pin.spec))
        }
    }
    return { texts, skipped }
}

/** The lines of the given units' lockfiles that name a registry on this machine. */
const lockfileReferences = (root: string, folders: readonly string[]): string[] =>
    folders.flatMap((folder) => {
        const where = lockPath(folder)
        const file = join(root, where)
        return existsSync(file) ? localReferences(where, readFileSync(file, "utf8")).map((one) => `${where}:${String(one.line)}`) : []
    })

/** The units a restore reinstalls: the root, and the unit of every pin the record holds. */
const restoreUnits = (root: string, record: InstallRecord): InstallUnit[] => {
    const units = unitsOf(root, record.packages.flatMap((one) => one.pins.map((pin) => ({ file: pin.file, name: one.name }))))
    return units.some((unit) => unit.folder === "") ? units : [{ folder: "", names: [] }, ...units]
}

/**
 * Applies a restore: puts the recorded pins back, drops every lock entry resolved on this machine in each unit's lockfile and runs npm
 * install from npmjs in each unit's folder; a failed install puts every unit's manifests and lockfile back.
 */
export const applyRestore = async (root: string, record: InstallRecord, npm: UnitNpm): Promise<{ readonly units: readonly InstallUnit[]; readonly skipped: readonly string[] }> => {
    const units = restoreUnits(root, record)
    const reverted = revertedTexts(root, record)
    const originals = new Map([...reverted.texts.keys()].map((file) => [file, readFileSync(join(root, file), "utf8")]))
    const locks = lockTexts(root, units)
    writeTexts(root, reverted.texts)
    for (const [folder, text] of locks) writeFileSync(join(root, lockPath(folder)), withoutLocked(text, lockPath(folder), lockedHere).text)
    try {
        for (const unit of units) await npm(join(root, unit.folder), ["install", "--no-audit", "--no-fund", "--prefer-online", ...NPMJS_FLAGS], unitLabel("npm install of the npm-served pins", unit.folder))
    } catch (error: unknown) {
        writeTexts(root, originals)
        for (const [folder, text] of locks) writeFileSync(join(root, lockPath(folder)), text)
        throw error
    }
    return { units, skipped: reverted.skipped }
}

/** Puts the app back on npm-served versions: the recorded pins, then npm's own install of them in every unit they belong to. */
export const restoreLocal = async (root: string, npm: UnitNpm = appNpm): Promise<{ readonly data: InstallLocalData; readonly message: string }> => {
    const record = readInstallRecord(root)
    const lines: string[] = []
    const restored: string[] = []
    if (record === undefined) {
        const folders = [...new Set([LOCKFILE_NAME, ...(await manifestFiles(root))].map((file) => installUnitOf(root, file)))]
        const stale = lockfileReferences(root, folders)
        if (stale.length > 0) throw new Refusal("INSTALL_LOCAL_NO_RECORD", `no install-local record here, but ${stale.slice(0, 3).join(", ")} names a registry on this machine; restore the files with git checkout -- package.json package-lock.json (each workspace package.json, and each subfolder package's package.json and package-lock.json), then npm ci`)
        lines.push("nothing to restore: no package is installed from the local registry")
        return { data: { mode: "restore", registry: "", installed: [], restored, record: undefined }, message: lines.join("\n") }
    }
    const { units, skipped } = await applyRestore(root, record, npm)
    const folders = units.map((unit) => unit.folder)
    const left = lockfileReferences(root, folders)
    if (left.length > 0) throw new Refusal("INSTALL_LOCAL_RESTORE_INCOMPLETE", `${left.slice(0, 3).join(", ")} still names a registry on this machine after the pins were put back (${skipped.join("; ") || "no pin was skipped"}); fix those pins to npm versions and run the restore again`)
    for (const folder of folders) {
        const where = lockPath(folder)
        const foreign = await integrityMismatches(where, readFileSync(join(root, where), "utf8"), (name, version) => npmCopy(root, name, version))
        if (foreign.length > 0) throw new Refusal("INSTALL_LOCAL_RESTORE_INCOMPLETE", `${where} still holds builds that are not npm's: ${foreign.slice(0, 3).join("; ")}; fix those pins to versions npm serves and run the restore again`)
    }
    rmSync(installRecordFile(root), { force: true })
    restored.push(...record.packages.map((one) => one.name))
    lines.push(`restored ${restored.join(", ")} to the pins ${installRecordFile(root)} recorded, reinstalled from npm; ${folders.map(lockPath).join(", ")} hold npm's resolved and integrity again`, ...skipped.map((one) => `warning: ${one}`))
    return { data: { mode: "restore", registry: "", installed: [], restored, record: undefined }, message: lines.join("\n") }
}

/**
 * `starci deps install-local <package>[@version]...`: the app side of the local registry. For each named package it takes the version
 * `deps publish-local` published last (or the one named), sets every requirement of the package in the app's manifests to it (an
 * `overrides` entry for a package nothing requires), drops the package's lock entries so npm resolves it again, runs `npm install` with
 * `@starci` resolving from the registry on this machine (and, for `starci-harness`, the registry named for that command alone), every resolved
 * host kept (`--replace-registry-host=never`), and records the replaced pins in the untracked tool cache (`install-local.json` beside the check
 * journal). `--restore` puts those pins back, drops every lock entry resolved on this machine and installs from npmjs with the registry named on
 * the command, so the lockfile holds npm's `resolved` and integrity and no file naming the machine is committed (`DEPS_LOCAL_REGISTRY_COMMITTED`,
 * `DEPS_LOCK_INTEGRITY`). An install is dry until `--execute`; the restore acts at once.
 */
export const depsInstallLocalVerb = defineVerb({
    path: ["deps", "install-local"],
    summary: "install the version the local registry's last publish-local gave each named @starci package into the app like npm and record the pins they replace (dry until --execute); --restore puts the npm pins back and reinstalls from npmjs before a commit",
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/deps-install-local@1",
    flags: {
        packages: { kind: "rest", summary: "the packages (grammar or @starci/grammar; starci-harness for the CLI), each with an optional @<version> the registry lists; default the version published last" },
        execute: { kind: "boolean", summary: "change the pins and install (default: print the plan only)" },
        restore: { kind: "boolean", summary: "put the recorded npm pins back and install them from npmjs, dropping every lock entry resolved on this machine" },
    },
    run: async (context, flags) => {
        const port = PORT
        if (flags.restore && flags.packages.length > 0) throw new UsageError("--restore takes no package: it puts back every pin the install recorded")
        if (!flags.restore && flags.packages.length === 0) throw new UsageError("name the packages to install (starci deps install-local grammar), or pass --restore")
        const root = await repositoryRoot(context.cwd)
        assertNpm(root)
        if (flags.restore) return restoreLocal(root)
        return installLocal(root, flags.packages.map(parseRequested), port, flags.execute)
    },
})
