import { inOrder } from "../../harness/sequential.js"
import { Refusal } from "../../shared/errors.js"
import { git } from "../../shared/git.js"
import { committedFiles, LOCKFILE } from "./local-refs.js"
import { harnessLocked } from "./lockfile.js"
import type { LockedPackage } from "./lockfile.js"
import { npmCopy } from "./npm-copy.js"
import type { NpmCopy } from "./npm-copy.js"

/** Asks what npm serves of `name@version`. The specs replace it; every other caller takes `npmCopy`. */
export type ServedLookup = (name: string, version: string) => Promise<NpmCopy | undefined>

const short = (integrity: string): string => `${integrity.slice(0, 19)}...`

/**
 * The installed harness packages of a lockfile whose integrity is not the one npm serves for their version, one line each. A version npm
 * does not serve is not judged here (the pin gates and the release plan judge it); a harness package of a lockfile is the tarball npm
 * publishes, never a copy of the same version built elsewhere, whose bytes (and so integrity) differ.
 */
export const integrityMismatches = async (file: string, text: string, served: ServedLookup, asked: Map<string, NpmCopy | undefined> = new Map()): Promise<string[]> => {
    const locked: LockedPackage[] = harnessLocked(text, file).filter((one) => one.version !== undefined && one.integrity !== undefined)
    const lines = await inOrder(locked, async (one): Promise<string[]> => {
        const { version = "", integrity = "" } = one
        const key = `${one.name}@${version}`
        if (!asked.has(key)) asked.set(key, await served(one.name, version))
        const theirs = asked.get(key)?.integrity
        return theirs === undefined || theirs === integrity ? [] : [`${file} ${one.key}: ${key} has ${short(integrity)}, npm serves ${short(theirs)}`]
    })
    return lines.flat()
}

/**
 * Refuses DEPS_LOCK_INTEGRITY when a lockfile committed at `revision` holds a harness package (a `@starci` package or the CLI) at a version
 * npm serves with another integrity: CI and production install that lockfile from npm and would fail on the mismatch, as they would on a
 * build from the local registry (`deps install-local --restore` puts npm's back). It judges every repository, an app or the harness alike.
 */
export const judgeLockIntegrity = async (root: string, revision: string, served: ServedLookup = (name, version) => npmCopy(root, name, version)): Promise<void> => {
    const asked = new Map<string, NpmCopy | undefined>()
    const files = await committedFiles(root, revision, (base) => LOCKFILE.test(base))
    const found = (await inOrder(files, async (file) => integrityMismatches(file, await git(root, ["show", `${revision}:${file}`]), served, asked))).flat()
    if (found.length === 0) return
    const more = found.length > 5 ? ` and ${String(found.length - 5)} more` : ""
    throw new Refusal("DEPS_LOCK_INTEGRITY", `committed lockfiles hold harness packages that are not npm's tarballs: ${found.slice(0, 5).join("; ")}${more}. Run starci deps install-local --restore to install them from npm, then commit that`)
}
