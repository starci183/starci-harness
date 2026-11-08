import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { withHeavySlot } from "../../harness/heavy.js"
import { Refusal } from "../../shared/errors.js"
import { captureNpm } from "../../shared/exec.js"
import { git, nulPaths } from "../../shared/git.js"
import type { WorkspacePackage } from "../../shared/workspace.js"
import { tail } from "./packages.js"
import { withManifest } from "./tarball.js"

/**
 * The manifest field that carries the source digest of a packed harness or tool package. The check cache keys a package on it, not on its version or
 * integrity (`@starci/hfs` `cache/fingerprint.mts` SOURCE_FIELD), so the build `deps publish-local` packs and the build CI publishes to npm from one
 * source are one key. It is stamped into the tarball's manifest; the folder's `package.json` in git never holds it.
 */
export const SOURCE_FIELD = "starciSource"

const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex")

/**
 * The digest of a package's source: every tracked file of its folder by path and content. A file the work tree holds as git does is named by its blob, so a clean
 * tree digests to the same value on every host for one commit; a file the work tree changed (or removed) is named by its bytes, so a dirty build never claims
 * the digest of the commit it started from.
 */
export const sourceDigest = async (root: string, relativeDir: string): Promise<string> => {
    const staged = nulPaths(await git(root, ["ls-files", "-s", "-z", "--", relativeDir]))
    const modified = new Set(nulPaths(await git(root, ["ls-files", "-m", "-z", "--", relativeDir])))
    const lines = staged
        .map((entry) => {
            const tab = entry.indexOf("\t")
            const blob = entry.slice(0, tab).split(" ")[1] ?? ""
            const file = entry.slice(tab + 1)
            if (!modified.has(file)) return `${file}\0${blob}`
            try {
                return `${file}\0work:${sha256(readFileSync(join(root, file)))}`
            } catch {
                return `${file}\0removed`
            }
        })
        .toSorted((left, right) => left.localeCompare(right))
    return sha256(lines.join("\n"))
}

/** A package manifest's text with the source digest stamped (and `gitHead` when given), in its own indent and line ending. */
export const withSource = (text: string, digest: string, gitHead?: string): string => {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Refusal("DEPS_MANIFEST_UNREADABLE", "a package.json holds a JSON object")
    const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? "  "
    const eol = text.includes("\r\n") ? "\r\n" : "\n"
    const written = JSON.stringify({ ...parsed, ...(gitHead === undefined ? {} : { gitHead }), [SOURCE_FIELD]: digest }, null, indent).replaceAll("\n", eol)
    return `${written}${/\r?\n$/.test(text) ? eol : ""}`
}

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
export const packStamped = async (given: { readonly pkg: WorkspacePackage; readonly root: string; readonly scratch: string; readonly name: string; readonly edit?: ((text: string) => string) | undefined; readonly gitHead?: string | undefined }): Promise<string> => {
    const { pkg, root, scratch, name, edit = (text: string) => text, gitHead } = given
    const packed = await withHeavySlot("build", `npm pack ${pkg.name}`, pkg.dir, {}, (held) => captureNpm(["pack", "--pack-destination", scratch, "--json"], pkg.dir, held.options))
    const filename = packedFilename(packed.stdout)
    if (packed.exitCode !== 0 || filename === undefined) throw new Refusal("PUBLISH_LOCAL_FAILED", `npm pack of ${pkg.name} failed:\n${tail(packed.stdout, packed.stderr)}`)
    return stampArchive({ pkg, root, archive: join(scratch, filename.replaceAll("/", "-").replace(/^@/, "")), scratch, name, edit, gitHead })
}

/** The file name `npm pack` gives a package's tarball: `@starci/hfs` at 6.5.2 is `starci-hfs-6.5.2.tgz`. */
export const tarballName = (name: string, version: string): string => `${name.replace(/^@/u, "").replaceAll("/", "-")}-${version}.tgz`

/**
 * Writes into `scratch` a copy of the packed tarball `archive` whose manifest carries the source digest of `root` (and `gitHead`), as `packStamped` does for a
 * tarball it packed itself. CI packs each package once, after its tests (the `package` job of ci.yml), and publishes those tested bits through this.
 */
export const stampArchive = async (given: { readonly pkg: WorkspacePackage; readonly root: string; readonly archive: string; readonly scratch: string; readonly name: string; readonly edit?: ((text: string) => string) | undefined; readonly gitHead?: string | undefined }): Promise<string> => {
    const { pkg, root, archive, scratch, name, edit = (text: string) => text, gitHead } = given
    const digest = await sourceDigest(root, pkg.relativeDir)
    const stamped = join(scratch, name)
    writeFileSync(stamped, withManifest(readFileSync(archive), (text) => withSource(edit(text), digest, gitHead)))
    return stamped
}
