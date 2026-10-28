import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { Refusal } from "../shared/errors.js"
import { loadPolicy, locatePolicy } from "./policy.js"

/** Replaces the path of the harness's secret.env; the bench points it at a file of its run. */
export const SECRET_ENV_FILE_ENV = "STARCI_SECRET_ENV"

/** The harness's secret.env: STARCI_SECRET_ENV, else secret.env at the harness root (the folder that holds policy/). */
export const secretEnvPath = (): string => {
    const override = process.env[SECRET_ENV_FILE_ENV]
    return override === undefined || override === "" ? join(dirname(locatePolicy()), "secret.env") : override
}

/** Where a secret was found: the process environment wins over secret.env. */
export type SecretSource = "environment" | "secret.env"

/** One secret by its key: the value goes only to the caller that asked, never into output, errors or evidence. */
export interface Secret {
    readonly value: string
    readonly source: SecretSource
}

const unquote = (raw: string): string => {
    const quote = raw[0]
    if ((quote === '"' || quote === "'") && raw.length >= 2 && raw.endsWith(quote)) {
        const inner = raw.slice(1, -1)
        return quote === '"' ? inner.replaceAll(/\\([nrt"\\])/g, (_, escaped: string) => ({ n: "\n", r: "\r", t: "\t" })[escaped] ?? escaped) : inner
    }
    const comment = raw.search(/\s#/)
    return (comment === -1 ? raw : raw.slice(0, comment)).trim()
}

/** The value of `key` in dotenv text (KEY=VALUE, an optional `export `, quotes, # comments; the last line wins); no other key is kept. */
const valueIn = (text: string, key: string): string | undefined => {
    let found: string | undefined
    for (const line of text.split(/\r?\n/)) {
        const entry = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line)
        if (entry?.[1] === key) found = unquote((entry[2] ?? "").trim())
    }
    return found
}

const fileValue = (key: string): string | undefined => {
    const file = secretEnvPath()
    let text: string
    try {
        text = readFileSync(file, "utf8")
    } catch (error: unknown) {
        const code = error instanceof Error && "code" in error ? String(error.code) : "unknown"
        if (code === "ENOENT") return undefined
        throw new Refusal("SECRET_ENV_UNREADABLE", `${file} is not readable (${code})`)
    }
    return valueIn(text, key)
}

/**
 * The one reader of host secrets: `key` from the process environment, else from the harness's secret.env, or undefined when
 * neither sets it (an empty value is unset). Only the keys policy/security.yaml `secretKeys` lists are read; any other is
 * refused SECRET_KEY_UNLISTED before a file is opened. No other key of the file is kept, and no message carries a value.
 */
export const lookupSecret = (key: string): Secret | undefined => {
    const listed = loadPolicy().security.secretKeys
    if (!listed.includes(key)) throw new Refusal("SECRET_KEY_UNLISTED", `${key} is not a secret key the harness reads; policy/security.yaml secretKeys lists ${listed.join(", ")}`)
    const fromEnv = (process.env[key] ?? "").trim()
    if (fromEnv !== "") return { value: fromEnv, source: "environment" }
    const fromFile = (fileValue(key) ?? "").trim()
    return fromFile === "" ? undefined : { value: fromFile, source: "secret.env" }
}

/** Where the owner sets `key`, for a refusal or a status line. */
export const secretHome = (key: string): string => `set ${key} in secret.env (see secret.env.example) or in the environment`
