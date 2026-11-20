import { posix } from "node:path"
import { git, nulPaths } from "../../shared/git.js"
import { isManifest, parseManifest } from "./packages.js"
import type { Manifest } from "./packages.js"

/** A workspace member of the repository at a revision: its name, version and repository folder. */
export interface WorkspaceMember {
    readonly name: string
    readonly version: string
    readonly folder: string
}

/** A workspace glob as a regular expression over a repository folder: `*` is one path segment, `**` any depth. */
const globExpression = (glob: string): RegExp => {
    const cleaned = glob.replace(/^\.\//, "").replace(/\/+$/, "")
    const source = cleaned
        .split("/")
        .map((segment) => (segment === "**" ? "(?:[^/]+/)*[^/]+" : segment.replace(/[$()+.?[\\\]^{|}]/g, String.raw`\$&`).replaceAll("*", "[^/]*")))
        .join("/")
    return new RegExp(`^${source}$`)
}

/** The workspace globs of a root manifest, npm's `workspaces` list or yarn's `{ packages }`. */
const workspaceGlobs = (manifest: Manifest): string[] => {
    const declared: unknown = manifest.workspaces
    const list: unknown = typeof declared === "object" && declared !== null && !Array.isArray(declared) ? (declared as { packages?: unknown }).packages : declared
    return Array.isArray(list) ? list.filter((each): each is string => typeof each === "string") : []
}

/**
 * The workspace members of the repository as committed at `revision`: the folders the root package.json `workspaces` globs match
 * (a `!` glob excludes) that hold a manifest with a name and version. Names are read from the manifests, never guessed.
 */
export const committedWorkspaceMembers = async (root: string, revision: string): Promise<WorkspaceMember[]> => {
    const files = nulPaths(await git(root, ["ls-tree", "-r", "-z", "--name-only", revision])).filter(isManifest)
    if (!files.includes("package.json")) return []
    const globs = workspaceGlobs(parseManifest(await git(root, ["show", `${revision}:package.json`]), `${revision}:package.json`))
    const included = globs.filter((glob) => !glob.startsWith("!")).map(globExpression)
    const excluded = globs.filter((glob) => glob.startsWith("!")).map((glob) => globExpression(glob.slice(1)))
    const members: WorkspaceMember[] = []
    for (const file of files) {
        const folder = posix.dirname(file)
        if (folder === "." || !included.some((glob) => glob.test(folder)) || excluded.some((glob) => glob.test(folder))) continue
        const manifest = parseManifest(await git(root, ["show", `${revision}:${file}`]), `${revision}:${file}`)
        if (typeof manifest.name === "string" && typeof manifest.version === "string") members.push({ name: manifest.name, version: manifest.version, folder })
    }
    return members
}

/** How the committed lockfile records `name`: a link to a folder, an install from a registry, or nothing (no lockfile, or no entry). */
export type LockRecord = { readonly kind: "link"; readonly folder: string } | { readonly kind: "installed" } | { readonly kind: "absent" }

/** The record of `node_modules/<name>` in the package-lock.json committed at `revision`. */
export const lockRecordOf = async (root: string, revision: string, name: string): Promise<LockRecord> => {
    let text: string
    try {
        text = await git(root, ["show", `${revision}:package-lock.json`])
    } catch {
        return { kind: "absent" }
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(text)
    } catch {
        return { kind: "absent" }
    }
    const packages = typeof parsed === "object" && parsed !== null ? (parsed as { packages?: Record<string, { link?: unknown; resolved?: unknown } | undefined> }).packages : undefined
    const entry = packages?.[`node_modules/${name}`]
    if (entry === undefined) return { kind: "absent" }
    return entry.link === true && typeof entry.resolved === "string" ? { kind: "link", folder: entry.resolved } : { kind: "installed" }
}

/**
 * Whether the workspace satisfies `name@spec` at `revision`: the repository has a workspace member of that name at exactly that version,
 * and the committed lockfile, when it records the package, links it to the member's folder (`"link": true`), which is what `npm ci` installs.
 * A member at another version, or a lock that installs the name from a registry, is not satisfied: npm would ask the registry.
 */
export const workspaceSatisfies = async (root: string, revision: string, members: readonly WorkspaceMember[], name: string, spec: string): Promise<boolean> => {
    const member = members.find((one) => one.name === name && one.version === spec)
    if (member === undefined) return false
    const record = await lockRecordOf(root, revision, name)
    return record.kind === "absent" || (record.kind === "link" && record.folder === member.folder)
}
