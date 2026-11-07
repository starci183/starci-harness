import { z } from "zod"
import { Refusal } from "../../shared/errors.js"
import { namesThisMachine } from "./local-refs.js"
import { isHarnessPackage } from "./packages.js"

const entrySchema = z.looseObject({ version: z.string().optional(), resolved: z.string().optional(), integrity: z.string().optional() })
const lockSchema = z.looseObject({ packages: z.record(z.string(), entrySchema).optional() })

/** One installed package of a lockfile: its install path, its package name and what npm recorded of it. */
export interface LockedPackage {
    readonly key: string
    readonly name: string
    readonly version: string | undefined
    readonly resolved: string | undefined
    readonly integrity: string | undefined
}

const MODULES = "node_modules/"

/** The package name of a lockfile install path (`fe/node_modules/@s/y/node_modules/z` is `z`); undefined for a workspace or the root. */
export const lockedName = (key: string): string | undefined => {
    const at = key.lastIndexOf(MODULES)
    return at < 0 ? undefined : key.slice(at + MODULES.length)
}

const parseLock = (text: string, where: string): z.infer<typeof lockSchema> => {
    let raw: unknown
    try {
        raw = JSON.parse(text)
    } catch {
        throw new Refusal("DEPS_LOCKFILE_UNREADABLE", `${where} is not valid JSON`)
    }
    const parsed = lockSchema.safeParse(raw)
    if (!parsed.success) throw new Refusal("DEPS_LOCKFILE_UNREADABLE", `${where} is not an npm lockfile`)
    return parsed.data
}

/** The installed packages of a lockfile's text. */
export const lockedPackages = (text: string, where: string): LockedPackage[] =>
    Object.entries(parseLock(text, where).packages ?? {}).flatMap(([key, entry]) => {
        const name = lockedName(key)
        return name === undefined ? [] : [{ key, name, version: entry.version, resolved: entry.resolved, integrity: entry.integrity }]
    })

/** The installed packages of the harness (a `@starci` package or the CLI) of a lockfile's text. */
export const harnessLocked = (text: string, where: string): LockedPackage[] => lockedPackages(text, where).filter((one) => isHarnessPackage(one.name))

/** Whether a locked package was resolved from a registry on this machine. */
export const lockedHere = (one: LockedPackage): boolean => one.resolved !== undefined && namesThisMachine(one.resolved)

/**
 * A lockfile's text without the installed packages `doomed` names, in its own indent and line ending. npm resolves them again from the
 * registry its flags name, which a version already locked would otherwise keep (npm trusts a lock entry whose version satisfies the pin).
 */
export const withoutLocked = (text: string, where: string, doomed: (one: LockedPackage) => boolean): { readonly text: string; readonly dropped: readonly string[] } => {
    const lock = parseLock(text, where)
    const gone = new Set(lockedPackages(text, where).filter(doomed).map((one) => one.key))
    if (gone.size === 0) return { text, dropped: [] }
    const packages = Object.fromEntries(Object.entries(lock.packages ?? {}).filter(([key]) => !gone.has(key)))
    const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? "  "
    const eol = text.includes("\r\n") ? "\r\n" : "\n"
    const written = JSON.stringify({ ...lock, packages }, null, indent).replaceAll("\n", eol)
    return { text: `${written}${/\r?\n$/.test(text) ? eol : ""}`, dropped: [...gone] }
}
