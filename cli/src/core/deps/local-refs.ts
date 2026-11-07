import { posix } from "node:path"
import { Refusal } from "../../shared/errors.js"
import { git, nulPaths } from "../../shared/git.js"
import { inOrder } from "../../harness/sequential.js"

/** The registry every judgement of "what npm serves" asks, whatever the caller's npm configuration or environment says. */
export const NPMJS_REGISTRY = "https://registry.npmjs.org/"

/**
 * The npm flags that pin a question to the public registry. `starci deps install-local` points `@starci:registry`
 * at a registry on this machine through the environment or a user-level npmrc; a gate asking "can CI install this?" must never be
 * answered by that registry, so every such `npm view` and `npm pack` carries these (command-line flags beat both).
 */
export const NPMJS_FLAGS: readonly string[] = [`--registry=${NPMJS_REGISTRY}`, `--@starci:registry=${NPMJS_REGISTRY}`]

/** Whether a host names this machine or a container's view of it: a registry there is never reachable from CI or production. */
export const isLoopbackHost = (host: string): boolean => {
    const name = host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "")
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
const RESOLVED = /"resolved"\s*:\s*("(?:[^"\\]|\\.)*")/g
const NPMRC_KEY = /^\s*(?:@[\w.-]+:)?registry\s*=\s*/i
const NPMRC_VALUE = /^(?:("(?:[^"\\]|\\.)*")|'([^']*)'|([^;\s#]+))/

const registryAddress = (url: string): string => {
    const parsed = new URL(url.replace(/^\/\//, "http://"))
    return `${parsed.protocol}//${parsed.host}`
}

const jsonString = (text: string | undefined): string | undefined => {
    if (text === undefined) return undefined
    try {
        const value: unknown = JSON.parse(text)
        return typeof value === "string" ? value : undefined
    } catch {
        return undefined
    }
}

const npmrcRegistry = (line: string): string | undefined => {
    const key = NPMRC_KEY.exec(line)
    if (key === null) return undefined
    const match = NPMRC_VALUE.exec(line.slice(key[0].length))
    return jsonString(match?.[1]) ?? match?.[2] ?? match?.[3]
}

const resolvedCandidates = (text: string): { readonly url: string | undefined; readonly line: number }[] => {
    let offset = 0
    let line = 1
    return [...text.matchAll(RESOLVED)].map((match) => {
        line += text.slice(offset, match.index).split("\n").length - 1
        offset = match.index
        return { url: jsonString(match[1]), line }
    })
}

/** The lines of one committed file that name a loopback registry: a lockfile's `resolved` URL, or a `registry` setting of an `.npmrc`. */
export const localReferences = (file: string, text: string): LocalReference[] => {
    const base = posix.basename(file)
    let candidates: { readonly url: string | undefined; readonly line: number }[] = []
    if (LOCKFILE.test(base)) candidates = resolvedCandidates(text)
    else if (base === ".npmrc") candidates = text.split("\n").map((raw, index) => ({ url: npmrcRegistry(raw), line: index + 1 }))
    return candidates.flatMap(({ url, line }): LocalReference[] => {
        const host = url === undefined ? undefined : hostOf(url.replace(/^\/\//, "http://"))
        return url !== undefined && host !== undefined && isLoopbackHost(host) ? [{ file, line, url }] : []
    })
}

/**
 * Refuses DEPS_LOCAL_REGISTRY_COMMITTED when a lockfile or `.npmrc` committed at `revision` names a registry on this machine
 * (`starci deps install-local` writes such a `resolved` into package-lock.json): CI and production cannot reach it, so
 * the app would stop installing. It judges every repository, an app or the harness alike.
 */
export const judgeLocalRegistry = async (root: string, revision: string): Promise<void> => {
    const files = nulPaths(await git(root, ["ls-tree", "-r", "-z", "--name-only", revision])).filter(
        (file) => !file.split("/").includes("node_modules") && (LOCKFILE.test(posix.basename(file)) || posix.basename(file) === ".npmrc"),
    )
    const found = (await inOrder(files, async (file) => localReferences(file, await git(root, ["show", `${revision}:${file}`])))).flat()
    if (found.length === 0) return
    const listed = found.slice(0, 5).map((one) => `${one.file}:${String(one.line)} ${registryAddress(one.url)}`).join("; ")
    const more = found.length > 5 ? ` and ${String(found.length - 5)} more` : ""
    throw new Refusal("DEPS_LOCAL_REGISTRY_COMMITTED", `committed files point npm at this machine: ${listed}${more}. CI cannot install from it. Run starci deps install-local --restore to put the npm pins back, then commit that`)
}
