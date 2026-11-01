import { posix } from "node:path"
import { Refusal } from "../../shared/errors.js"
import { git, nulPaths } from "../../shared/git.js"

/** The registry every judgement of "what npm serves" asks, whatever the caller's npm configuration or environment says. */
export const NPMJS_REGISTRY = "https://registry.npmjs.org/"

/**
 * The npm flags that pin a question to the public registry. `starci deps publish-local` lets a developer point `@starci:registry`
 * at a registry on this machine through the environment or a user-level npmrc; a gate asking "can CI install this?" must never be
 * answered by that registry, so every such `npm view` and `npm pack` carries these (command-line flags beat both).
 */
export const NPMJS_FLAGS: readonly string[] = [`--registry=${NPMJS_REGISTRY}`, `--@starci:registry=${NPMJS_REGISTRY}`]

/** Whether a host names this machine or a container's view of it: a registry there is never reachable from CI or production. */
export const isLoopbackHost = (host: string): boolean => {
    const name = host.toLowerCase().replace(/^\[|\]$/g, "")
    return name === "localhost" || name.endsWith(".localhost") || name === "host.docker.internal" || name === "0.0.0.0" || name === "::1" || name === "::" || /^127(?:\.\d{1,3}){3}$/.test(name)
}

const hostOf = (url: string): string | undefined => {
    try {
        return new URL(url).hostname
    } catch {
        return undefined
    }
}

/** One committed file that points npm at this machine. */
export interface LocalReference {
    readonly file: string
    readonly line: number
    readonly url: string
}

const LOCKFILE = /^(?:package-lock|npm-shrinkwrap)\.json$/
const RESOLVED = /"resolved"\s*:\s*"([^"]+)"/
const NPMRC_REGISTRY = /^\s*(?:@[\w.-]+:)?registry\s*=\s*(\S+)/i

/** The lines of one committed file that name a loopback registry: a lockfile's `resolved` URL, or a `registry` setting of an `.npmrc`. */
export const localReferences = (file: string, text: string): LocalReference[] => {
    const base = posix.basename(file)
    const pattern = LOCKFILE.test(base) ? RESOLVED : base === ".npmrc" ? NPMRC_REGISTRY : undefined
    if (pattern === undefined) return []
    return text.split("\n").flatMap((raw, index): LocalReference[] => {
        const url = pattern.exec(raw)?.[1]
        const host = url === undefined ? undefined : hostOf(url.replace(/^\/\//, "http://"))
        return url !== undefined && host !== undefined && isLoopbackHost(host) ? [{ file, line: index + 1, url }] : []
    })
}

/**
 * Refuses DEPS_LOCAL_REGISTRY_COMMITTED when a lockfile or `.npmrc` committed at `revision` names a registry on this machine
 * (`starci deps publish-local` installs write such a `resolved` into package-lock.json): CI and production cannot reach it, so
 * the app would stop installing. It judges every repository, an app or the harness alike.
 */
export const judgeLocalRegistry = async (root: string, revision: string): Promise<void> => {
    const files = nulPaths(await git(root, ["ls-tree", "-r", "-z", "--name-only", revision])).filter(
        (file) => !file.split("/").includes("node_modules") && (LOCKFILE.test(posix.basename(file)) || posix.basename(file) === ".npmrc"),
    )
    const found: LocalReference[] = []
    for (const file of files) found.push(...localReferences(file, await git(root, ["show", `${revision}:${file}`])))
    if (found.length === 0) return
    const listed = found.slice(0, 5).map((one) => `${one.file}:${String(one.line)} ${one.url}`).join("; ")
    const more = found.length > 5 ? ` and ${String(found.length - 5)} more` : ""
    throw new Refusal("DEPS_LOCAL_REGISTRY_COMMITTED", `committed files point npm at this machine: ${listed}${more}. CI cannot install from it. Restore the lockfile (git checkout -- package-lock.json, or starci deps source --npm), pin a version npm serves, and commit that`)
}
