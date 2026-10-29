import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal } from "../../shared/errors.js"

/** The stack pins, the one owner of every shared dependency's version, relative to the repository root. */
export const STACK_PINS = "contexts/stack/pins.yaml"

/** The CLI's manifest and lockfile, relative to the repository root. */
const CLI_MANIFEST = "cli/package.json"
const CLI_LOCK = "cli/package-lock.json"

/** The scope whose packages the CLI takes at their stack pins. */
const SCOPE = "@starci/"

/** The code of a CLI requirement or locked install of a @starci package that differs from its stack pin. */
export const CLI_PIN_SKEW = "CLI_PIN_SKEW"

const MANIFEST_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const

const pinsSchema = z.looseObject({ pins: z.record(z.string(), z.looseObject({ version: z.string().min(1) })) })
const manifestSchema = z.looseObject(Object.fromEntries(MANIFEST_FIELDS.map((field) => [field, z.record(z.string(), z.string()).optional()])))
const lockSchema = z.looseObject({ packages: z.record(z.string(), z.looseObject({ version: z.string().optional() })).optional() })

/** One place the CLI takes a @starci package at another version than its stack pin (undefined `expected`: no pin names it). */
export interface PinSkew {
    readonly code: typeof CLI_PIN_SKEW
    readonly package: string
    readonly where: string
    readonly expected: string | undefined
    readonly found: string
}

const readParsed = <T>(root: string, path: string, schema: z.ZodType<T>, parseText: (text: string) => unknown): T => {
    const file = join(root, path)
    if (!existsSync(file)) throw new Refusal("CLI_PINS_UNREADABLE", `${path} is missing: the CLI's @starci dependencies are judged against ${STACK_PINS}`)
    let raw: unknown
    try {
        raw = parseText(readFileSync(file, "utf8"))
    } catch {
        throw new Refusal("CLI_PINS_UNREADABLE", `${path} does not parse`)
    }
    const parsed = schema.safeParse(raw)
    if (!parsed.success) throw new Refusal("CLI_PINS_UNREADABLE", `${path} is not in the shape the pin gate reads: ${parsed.error.issues[0]?.message ?? "invalid"}`)
    return parsed.data
}

/**
 * Every place the CLI of the repository at `root` takes a @starci package at another version than contexts/stack/pins.yaml
 * pins: a requirement of cli/package.json (any dependency field) and each copy cli/package-lock.json resolves. Empty when they
 * agree. The CLI runs the packages its lockfile installs, so a pin raised without the CLI's requirement and lockfile leaves
 * every CLI verb on the old package.
 */
export const cliPinSkews = (root: string): PinSkew[] => {
    const pins = readParsed(root, STACK_PINS, pinsSchema, parse).pins
    const manifest = readParsed(root, CLI_MANIFEST, manifestSchema, JSON.parse)
    const lock = readParsed(root, CLI_LOCK, lockSchema, JSON.parse)
    const skew = (name: string, where: string, found: string): PinSkew[] => {
        const expected = pins[name]?.version
        return expected === found ? [] : [{ code: CLI_PIN_SKEW, package: name, where, expected, found }]
    }
    const required = MANIFEST_FIELDS.flatMap((field) =>
        Object.entries(manifest[field] ?? {})
            .filter(([name]) => name.startsWith(SCOPE))
            .flatMap(([name, spec]) => skew(name, `${CLI_MANIFEST} ${field}`, spec)),
    )
    const locked = Object.entries(lock.packages ?? {}).flatMap(([path, entry]) => {
        const at = path.lastIndexOf(`node_modules/${SCOPE}`)
        if (at < 0 || entry.version === undefined) return []
        return skew(path.slice(at + "node_modules/".length), `${CLI_LOCK} ${path}`, entry.version)
    })
    return [...required, ...locked]
}

/** One line per skew: the package, where, the pin expected and the version found. */
export const describeSkews = (skews: readonly PinSkew[]): string[] =>
    skews.map((skew) => `${skew.code} ${skew.package}: ${skew.where} has ${skew.found}, ${STACK_PINS} ${skew.expected === undefined ? "pins no version" : `pins ${skew.expected}`}`)

/** Refuses CLI_PIN_SKEW, naming each package, where, expected and found, when the CLI's @starci versions differ from their pins. */
export const assertCliPins = (root: string): void => {
    const skews = cliPinSkews(root)
    if (skews.length > 0) {
        throw new Refusal(CLI_PIN_SKEW, `${describeSkews(skews).join("; ")}; raise the CLI requirement and lockfile to the pin (npm install in cli/) once npm serves it`)
    }
}
