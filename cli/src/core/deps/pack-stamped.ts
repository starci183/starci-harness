import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { withHeavySlot } from "../../harness/heavy.js"
import { Refusal } from "../../shared/errors.js"
import { captureNpm } from "../../shared/exec.js"
import type { WorkspacePackage } from "../../shared/workspace.js"
import { sourceDigest, sourceDigestParts, tail, type SourceSplit } from "./packages.js"
import { withManifest } from "./tarball.js"

/**
 * The manifest field that carries the source digest of a packed harness or tool package. The check cache keys a package on it, not on its version or
 * integrity (`@starci/hfs` `cache/fingerprint.mts` SOURCE_FIELD), so the build `deps publish-local` packs and the build CI publishes to npm from one
 * source are one key. It is stamped into the tarball's manifest; the folder's `package.json` in git never holds it.
 */
export const SOURCE_FIELD = "starciSource"

/**
 * The manifest field that carries the source digest in parts, for a package that ships a pure-data file the check cache keys on its own: `core` (every tracked
 * file but the named ones) and one digest per named file. `starciSource` stays the digest of the whole. The cache keys `@starci/hfs` on `core` and its pin data
 * on its own part, so a Grammar-only release that moves `canon-pins.yaml` never re-runs the structure records (check-cache.md "The fingerprint").
 */
export const SOURCE_PARTS_FIELD = "starciSourceParts"

/**
 * The pure-data files the check cache keys as parts of their own, by package name (the file's path inside the package). Each is read by a narrow set of rules
 * that run every run, so no cached record depends on it; `@starci/hfs` `cache/fingerprint.mts` SPLIT_PARTS names the same parts and the families that read them.
 */
export const SOURCE_SPLITS: Readonly<Record<string, readonly SourceSplit[]>> = {
    "@starci/hfs": [{ name: "canon-pins", file: "runtime/knowledge/hfs/canon-pins.yaml" }],
}

/** The digest of a package's source (owned by packages.ts, where the install freshness of a `file:` copy reads it too). */
export { sourceDigest }

/** A package manifest's text with the source digest stamped (and `gitHead` when given), in its own indent and line ending. */
export const withSource = (text: string, digest: string, gitHead?: string, parts?: Readonly<Record<string, string>>): string => {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Refusal("DEPS_MANIFEST_UNREADABLE", "a package.json holds a JSON object")
    const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? "  "
    const eol = text.includes("\r\n") ? "\r\n" : "\n"
    const written = JSON.stringify({ ...parsed, ...(gitHead === undefined ? {} : { gitHead }), [SOURCE_FIELD]: digest, ...(parts === undefined ? {} : { [SOURCE_PARTS_FIELD]: parts }) }, null, indent).replaceAll("\n", eol)
    return `${written}${/\r?\n$/.test(text) ? eol : ""}`
}

/** An edit of the copy's other text files: the file's path inside the package and its text to the new text, or undefined to keep it (tarball.ts withEntries). */
export type EntryEdit = (path: string, text: string) => string | undefined

const packSchema = z.array(z.object({ filename: z.string() })).min(1)

/**
 * The tarball name `npm pack --json` reports. Its stdout carries what the package's lifecycle scripts print (a `prepack` build) before the JSON,
 * so the report is read from the last line that opens the JSON array; undefined when there is none.
 */
export const packedFilename = (stdout: string): string | undefined => {
    const lines = stdout.split(/\r?\n/u)
    for (let at = lines.length - 1; at >= 0; at -= 1) {
        if (lines[at] !== "[") continue
        let raw: unknown
        try {
            raw = JSON.parse(lines.slice(at).join("\n"))
        } catch {
            continue
        }
        const parsed = packSchema.safeParse(raw)
        if (parsed.success) return parsed.data[0]?.filename
    }
    return undefined
}

/**
 * Packs the package folder as `npm pack` does (its lifecycle scripts run there) into `scratch` and returns the path of a tarball whose manifest is `edit` of
 * the packed one with the source digest of `root` stamped on top (and `gitHead`, which npm records for a folder publish and a tarball publish takes from the manifest). Every package is published from this tarball, by CI and by `deps publish-local` alike.
 */
export const packStamped = async (given: { readonly pkg: WorkspacePackage; readonly root: string; readonly scratch: string; readonly name: string; readonly edit?: ((text: string) => string) | undefined; readonly entries?: EntryEdit | undefined; readonly gitHead?: string | undefined }): Promise<string> => {
    const { pkg, root, scratch, name, edit = (text: string) => text, entries, gitHead } = given
    const packed = await withHeavySlot("build", `npm pack ${pkg.name}`, pkg.dir, {}, (held) => captureNpm(["pack", "--pack-destination", scratch, "--json"], pkg.dir, held.options))
    const filename = packedFilename(packed.stdout)
    if (packed.exitCode !== 0 || filename === undefined) throw new Refusal("PUBLISH_LOCAL_FAILED", `npm pack of ${pkg.name} failed:\n${tail(packed.stdout, packed.stderr)}`)
    return stampArchive({ pkg, root, archive: join(scratch, filename.replaceAll("/", "-").replace(/^@/, "")), scratch, name, edit, entries, gitHead })
}

/** The file name `npm pack` gives a package's tarball: `@starci/hfs` at 6.5.2 is `starci-hfs-6.5.2.tgz`. */
export const tarballName = (name: string, version: string): string => `${name.replace(/^@/u, "").replaceAll("/", "-")}-${version}.tgz`

/**
 * Writes into `scratch` a copy of the packed tarball `archive` whose manifest carries the source digest of `root` (and `gitHead`), as `packStamped` does for a
 * tarball it packed itself. CI packs each package once, after its tests (the `package` job of ci.yml), and publishes those tested bits through this.
 */
export const stampArchive = async (given: { readonly pkg: WorkspacePackage; readonly root: string; readonly archive: string; readonly scratch: string; readonly name: string; readonly edit?: ((text: string) => string) | undefined; readonly entries?: EntryEdit | undefined; readonly gitHead?: string | undefined }): Promise<string> => {
    const { pkg, root, archive, scratch, name, edit = (text: string) => text, entries, gitHead } = given
    const digest = await sourceDigest(root, pkg.relativeDir)
    const split = SOURCE_SPLITS[pkg.name]
    const parts = split === undefined ? undefined : await sourceDigestParts(root, pkg.relativeDir, split)
    const stamped = join(scratch, name)
    writeFileSync(stamped, withManifest(readFileSync(archive), (text) => withSource(edit(text), digest, gitHead, parts), entries))
    return stamped
}
