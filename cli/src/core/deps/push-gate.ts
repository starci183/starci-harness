import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, sep } from "node:path"
import { gunzipSync } from "node:zlib"
import { z } from "zod"
import { inOrder } from "../../harness/sequential.js"
import { Refusal } from "../../shared/errors.js"
import { captureNpm } from "../../shared/exec.js"
import { locateTree } from "../../shared/tree.js"
import { committedPins, installsOf, LOCAL_MARKER, manifestFiles } from "./packages.js"
import type { Install, Pin } from "./packages.js"

/** A pin the registry was asked about: its requirement and whether npm can install it. */
export interface PinVerdict extends Pin {
    readonly published: boolean
}

/** A local copy judged against npm: `ahead` says why the app runs code no published version holds. */
export interface LocalVerdict {
    readonly name: string
    readonly dir: string
    readonly version: string
    readonly folder: string
    readonly ahead: string | undefined
}

/** What the push gate judged; `app` is false outside a StarCi app, where it judges nothing. */
export interface PushJudgement {
    readonly app: boolean
    readonly revision: string
    readonly pins: readonly PinVerdict[]
    readonly local: readonly LocalVerdict[]
    readonly notes: readonly string[]
}

// A spec npm resolves from the registry: a version, range or dist-tag. A path, a protocol or a `user/repo` shorthand is not.
const fromRegistry = (spec: string): boolean => !/^(?:[a-z][\w+.-]*:|\.|\/|~\/)/i.test(spec) && !/^[\w.-]+\/[\w.-]+/.test(spec)

/** Whether `name@spec` has a published version; DEPS_REGISTRY_UNREACHABLE when npm cannot say, since an unknown is never a yes. */
const published = async (root: string, name: string, spec: string): Promise<boolean> => {
    if (!fromRegistry(spec)) return false
    const run = await captureNpm(["view", `${name}@${spec}`, "version", "--json"], root)
    if (run.exitCode === 0) return run.stdout.trim() !== ""
    if (/E404|ETARGET|No match found/.test(`${run.stdout}\n${run.stderr}`)) return false
    throw new Refusal("DEPS_REGISTRY_UNREACHABLE", `npm view ${name}@${spec} failed, so the pin cannot be called installable: ${run.stderr.trim().split("\n").slice(-3).join(" ")}`)
}

/** The regular files of an npm tarball, by their path inside the package (npm roots every entry at `package/`). */
const tarballFiles = (archive: Buffer): Map<string, Buffer> => {
    const files = new Map<string, Buffer>()
    let offset = 0
    let longName: string | undefined
    while (offset + 512 <= archive.length) {
        const header = archive.subarray(offset, offset + 512)
        if (header.every((byte) => byte === 0)) break
        const field = (start: number, length: number): string => {
            const text = header.subarray(start, start + length).toString("utf8")
            const end = text.indexOf("\0")
            return end === -1 ? text : text.slice(0, end)
        }
        const size = Number.parseInt(field(124, 12).trim() || "0", 8)
        const type = field(156, 1)
        const prefix = field(345, 155)
        const body = archive.subarray(offset + 512, offset + 512 + size)
        offset += 512 + Math.ceil(size / 512) * 512
        if (type === "x") {
            longName = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString("utf8"))?.[1]
            continue
        }
        if (type === "L") {
            longName = body.toString("utf8").replace(/\0+$/, "")
            continue
        }
        const name = longName ?? (prefix === "" ? field(0, 100) : `${prefix}/${field(0, 100)}`)
        longName = undefined
        if (type === "0" || type === "") files.set(name.replace(/^[^/]+\//, ""), body)
    }
    return files
}

const filesUnder = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true, recursive: true })
        .filter((entry) => entry.isFile())
        .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/"))

// A build stamp records when a build ran, not what it holds; the built files beside it are compared byte for byte.
const BUILD_STAMP = /(?:^|\/)\.build-stamp\.json$/

const sameText = (left: Buffer, right: Buffer): boolean => left.toString("latin1").replaceAll("\r\n", "\n") === right.toString("latin1").replaceAll("\r\n", "\n")

const packSchema = z.array(z.object({ filename: z.string() })).min(1)

/** The files of a local copy that differ from the published tarball of the same version (line endings aside), at most a few. */
const differingFiles = async (root: string, install: Install, version: string): Promise<string[]> => {
    const scratch = mkdtempSync(join(tmpdir(), "starci-deps-"))
    try {
        const run = await captureNpm(["pack", `${install.name}@${version}`, "--pack-destination", scratch, "--json"], root)
        let raw: unknown
        try {
            raw = JSON.parse(run.stdout)
        } catch {
            raw = undefined
        }
        const parsed = packSchema.safeParse(raw)
        const filename = parsed.success ? parsed.data[0]?.filename : undefined
        if (run.exitCode !== 0 || filename === undefined) throw new Refusal("DEPS_REGISTRY_UNREACHABLE", `npm pack ${install.name}@${version} failed, so the local copy cannot be compared with it`)
        const remote = tarballFiles(gunzipSync(readFileSync(join(scratch, filename.replaceAll("/", "-").replace(/^@/, "")))))
        const dir = join(root, install.dir)
        const local = new Map(filesUnder(dir).filter((file) => file !== LOCAL_MARKER).map((file) => [file, readFileSync(join(dir, file))]))
        const names = [...new Set([...local.keys(), ...remote.keys()])].filter((file) => !BUILD_STAMP.test(file)).sort((left, right) => left.localeCompare(right))
        return names.filter((file) => {
            const mine = local.get(file)
            const theirs = remote.get(file)
            return mine === undefined || theirs === undefined || !sameText(mine, theirs)
        })
    } finally {
        rmSync(scratch, { recursive: true, force: true })
    }
}

const SHOWN = 5

/** Why one local copy runs code no published version holds, or undefined when the published version holds exactly it. */
const aheadOf = async (root: string, install: Install, version: string): Promise<string | undefined> => {
    if (!(await published(root, install.name, version))) return `${version} is not on npm`
    const differing = await differingFiles(root, install, version)
    if (differing.length === 0) return undefined
    const more = differing.length > SHOWN ? ` and ${String(differing.length - SHOWN)} more` : ""
    return `${version} is on npm but this copy differs from it in ${differing.slice(0, SHOWN).join(", ")}${more}`
}

/**
 * The push gate of an app's `@starci` dependencies, run by the app's pre-push hook (`starci deps check`), `release push`,
 * `release cut` and `app release`. It refuses DEPS_PIN_UNPUBLISHED when a package.json committed at `revision` pins a
 * `@starci` package to a spec npm cannot install (no published version matches, or a path or protocol), since CI would
 * fail to install it; and DEPS_LOCAL_AHEAD when a local copy (`starci deps source --local`) runs code no published version
 * holds: its version is not on npm, or it is and the copy's files differ from that version's tarball (the build stamp aside).
 * Local mode alone never refuses: its record and copies are never committed. Outside a StarCi app (the harness itself,
 * whose packages the release plan judges) it judges nothing.
 */
export const judgePush = async (root: string, revision = "HEAD"): Promise<PushJudgement> => {
    const tree = locateTree(root).tree
    if (tree !== "lite" && tree !== "full") return { app: false, revision, pins: [], local: [], notes: ["not a StarCi app (no app hfs.json): nothing to judge"] }
    const pins = await committedPins(root, revision)
    const asked = new Map<string, boolean>()
    const verdicts = await inOrder(pins, async (pin): Promise<PinVerdict> => {
        const key = `${pin.name}@${pin.spec}`
        const known = asked.get(key) ?? (await published(root, pin.name, pin.spec))
        asked.set(key, known)
        return { ...pin, published: known }
    })
    const unpublished = verdicts.filter((pin) => !pin.published)
    if (unpublished.length > 0) {
        const listed = unpublished.map((pin) => `${pin.file} ${pin.field} ${pin.name}@${pin.spec}`).join("; ")
        throw new Refusal("DEPS_PIN_UNPUBLISHED", `CI cannot install these committed @starci pins: ${listed}. Publish the package (starci release publish) or pin a published version, then commit`)
    }
    const names = [...new Set(pins.map((pin) => pin.name))]
    const copies = installsOf(root, await manifestFiles(root), names).filter((install) => install.local !== undefined)
    const local = await inOrder(copies, async (install): Promise<LocalVerdict> => {
        const version = install.version ?? install.local?.version ?? "0.0.0"
        return { name: install.name, dir: install.dir, version, folder: install.local?.folder ?? "", ahead: await aheadOf(root, install, version) }
    })
    const ahead = local.filter((copy) => copy.ahead !== undefined)
    if (ahead.length > 0) {
        const listed = ahead.map((copy) => `${copy.name} in ${copy.dir} (from ${copy.folder}): ${copy.ahead ?? ""}`).join("; ")
        throw new Refusal("DEPS_LOCAL_AHEAD", `the app runs @starci code no published version holds: ${listed}. Publish it under a new version and raise the pin, or run starci deps source --npm and prove the app on npm`)
    }
    const notes = local.flatMap((copy) => {
        const pinned = verdicts.filter((pin) => pin.name === copy.name && pin.spec !== copy.version)
        return pinned.length === 0 ? [] : [`${copy.name} runs local ${copy.version} (equal to npm) while ${pinned.map((pin) => `${pin.file} pins ${pin.spec}`).join(", ")}; raise the pin if the app needs ${copy.version}`]
    })
    return { app: true, revision, pins: verdicts, local, notes }
}
