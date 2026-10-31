import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { Refusal } from "../shared/errors.js"
import { loadPolicy, locatePolicy } from "./policy.js"

/** The harness's secret.env: secret.env at the harness root (the folder that holds policy/). */
export const secretEnvPath = (): string => join(dirname(locatePolicy()), "secret.env")

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

const fileValue = (key: string, file: string = secretEnvPath()): string | undefined => {
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

/** The host key that holds the age identity apps' sealed members open with. */
const AGE_IDENTITY_KEY = "SOPS_AGE_KEY"

/** True when `dir` is a harness checkout: the folder that holds cli/, ops/checks.yaml and policy/quality.yaml. */
const isHarnessCheckout = (dir: string): boolean =>
    existsSync(join(dir, "cli")) && existsSync(join(dir, "ops", "checks.yaml")) && existsSync(join(dir, "policy", "quality.yaml"))

/**
 * The harness home of a folder: the nearest ancestor of `from` (itself included) that is a harness checkout, or whose `.claude`
 * folder is one (an app under `D:/apps/x` finds `D:/.claude`, the checkout every agent started below it inherits), else
 * undefined. A CLI an app installs (`<app>/node_modules/starci-harness`) is its own runtime root and carries no secret.env, so
 * this is where the host's secret.env is found for it.
 */
export const harnessHomeOf = (from: string): string | undefined => {
    let dir = resolve(from)
    for (;;) {
        if (isHarnessCheckout(dir)) return dir
        if (isHarnessCheckout(join(dir, ".claude"))) return join(dir, ".claude")
        const parent = dirname(dir)
        if (parent === dir) return undefined
        dir = parent
    }
}

/** Two paths name the same file, case folded on Windows. */
const samePath = (left: string, right: string): boolean => {
    const fold = (path: string): string => (process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path))
    return fold(left) === fold(right)
}

/**
 * The secret.env files the age identity is looked for in, in order: this CLI's own (secretEnvPath), then the harness home's of
 * `cwd` (harnessHomeOf) when it is another file. Only paths are resolved; no file is opened.
 */
export const ageIdentityFiles = (cwd: string): string[] => {
    const own = secretEnvPath()
    const home = harnessHomeOf(cwd)
    const homeFile = home === undefined ? undefined : join(home, "secret.env")
    return homeFile === undefined || samePath(homeFile, own) ? [own] : [own, homeFile]
}

/**
 * The host's SOPS_AGE_KEY as @starci/hfs's last age identity source (after the environment and the app's own `.claude/secret.env`):
 * the process environment, else the first of ageIdentityFiles(`cwd`) that sets it. Its label names the files it looks in, and once
 * read the one that held the key; the value is read only when nothing before it selects an identity, is never put in a label,
 * and is handed to the sops child alone. SOPS_AGE_KEY is listed in policy/security.yaml `secretKeys` (lookupSecret's guard).
 */
export const hostAgeIdentity = (cwd: string = process.cwd()): { readonly label: string; readonly read: () => string | undefined } => {
    const files = ageIdentityFiles(cwd)
    let holder: string | undefined
    return {
        get label() {
            return holder ?? files.join(", then ")
        },
        read: () => {
            const fromEnv = lookupSecret(AGE_IDENTITY_KEY)
            if (fromEnv?.source === "environment") {
                holder = "the environment"
                return fromEnv.value
            }
            for (const file of files) {
                const value = (fileValue(AGE_IDENTITY_KEY, file) ?? "").trim()
                if (value !== "") {
                    holder = file
                    return value
                }
            }
            return undefined
        },
    }
}
