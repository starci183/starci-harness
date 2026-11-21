/**
 * The runtime public config of a Next.js front end: ONE image per sha, configured per environment when it starts (owner, 2026-11-21: "1 ảnh chỉnh
 * theo môi trường chứ?"). Next inlines every `process.env.NEXT_PUBLIC_*` read at build time, so a public URL read that way is frozen into the image.
 * Here the server renders an explicit allowlist of public keys from its runtime environment into `window.__ENV` (an inline script), and the client
 * reads them through one `publicEnv(key)`. Only keys named `NEXT_PUBLIC_*` may be allowlisted: a secret never has that name, and the allowlist is the
 * only way a value reaches the page.
 */

/** The global the inline script sets, `window.__ENV`. */
export const PUBLIC_ENV_GLOBAL = "__ENV"
/** The `id` of the inline script, so an app (or a test) finds the one element. */
export const PUBLIC_ENV_SCRIPT_ID = "starci-public-env"
/** The only key shape an allowlist may hold. */
export const PUBLIC_ENV_KEY = /^NEXT_PUBLIC_[A-Z0-9_]+$/u

/** Environment-like values: `process.env`, or a literal map. */
export type PublicEnvSource = Readonly<Record<string, string | undefined>>
/** The allowlisted values that are set. */
export type PublicEnvValues<Key extends string> = Readonly<Partial<Record<Key, string>>>

/** Where `readPublicEnv` looks; each is injectable for specs. */
export interface PublicEnvReadOptions {
    /** The values inlined at build or present in dev, read last (`{ NEXT_PUBLIC_X: process.env.NEXT_PUBLIC_X }`, written out so Next inlines it). */
    readonly fallback?: PublicEnvSource
    /** The global that carries `__ENV`; `globalThis` (the window in a browser) by default. */
    readonly scope?: object
    /** The runtime environment of the server; `process.env` when there is a `process`. */
    readonly env?: PublicEnvSource | undefined
}

/** The props of the inline script element: `<script {...props} />` in the root layout's head. */
export interface PublicEnvScriptProps {
    readonly id: string
    readonly nonce?: string
    readonly dangerouslySetInnerHTML: { readonly __html: string }
}

/** The bound reader of one app's allowlist, the one module its client and server read public config through. */
export interface PublicEnvReader<Key extends string> {
    readonly keys: readonly Key[]
    /** The value of an allowlisted key: `window.__ENV`, then the server's runtime environment, then the build/dev fallback. */
    readonly publicEnv: (key: Key) => string | undefined
    /** The inline script text, from the server's runtime environment (or `source`). */
    readonly script: (source?: PublicEnvSource) => string
    /** The props of the inline script element, with an optional CSP `nonce`. */
    readonly scriptProps: (options?: { readonly source?: PublicEnvSource; readonly nonce?: string }) => PublicEnvScriptProps
}

const processEnv = (): PublicEnvSource | undefined => (typeof process === "undefined" ? undefined : process.env)

/** Throws unless every key is a `NEXT_PUBLIC_*` name: the allowlist is explicit and public by construction. */
export const checkPublicEnvKeys = (keys: readonly string[]): void => {
    for (const key of keys) {
        if (!PUBLIC_ENV_KEY.test(key)) throw new TypeError(`${key} is not a public key: an allowlist holds NEXT_PUBLIC_* names only`)
    }
}

/** The allowlisted keys of `source` that hold a string, and nothing else. */
export const pickPublicEnv = <Key extends string>(keys: readonly Key[], source: PublicEnvSource = processEnv() ?? {}): PublicEnvValues<Key> => {
    checkPublicEnvKeys(keys)
    const out: Partial<Record<Key, string>> = {}
    for (const key of keys) {
        const value = source[key]
        if (typeof value === "string") out[key] = value
    }
    return out
}

const UNSAFE = /[<>&\u2028\u2029]/gu
const escapeChar = (char: string): string => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`

/** JSON safe inside an inline `<script>`: no `<`, `>` or `&` (so no `</script>` or `<!--`), and no U+2028/U+2029 line separators. */
export const serializePublicEnv = (values: Readonly<Record<string, string | undefined>>): string => JSON.stringify(values).replace(UNSAFE, escapeChar)

/** The inline script text that sets `window.__ENV` to the frozen allowlisted values of `source`. */
export const publicEnvScript = (keys: readonly string[], source?: PublicEnvSource): string =>
    `window.${PUBLIC_ENV_GLOBAL}=Object.freeze(${serializePublicEnv(pickPublicEnv(keys, source))});`

/** The props of the inline script element (`id`, an optional `nonce`, `dangerouslySetInnerHTML`). */
export const publicEnvScriptProps = (keys: readonly string[], options: { readonly source?: PublicEnvSource; readonly nonce?: string } = {}): PublicEnvScriptProps => ({
    id: PUBLIC_ENV_SCRIPT_ID,
    ...(options.nonce === undefined ? {} : { nonce: options.nonce }),
    dangerouslySetInnerHTML: { __html: publicEnvScript(keys, options.source) },
})

const fromGlobal = (scope: object, key: string): string | undefined => {
    const carried: unknown = Reflect.get(scope, PUBLIC_ENV_GLOBAL)
    if (carried === null || typeof carried !== "object") return undefined
    const value: unknown = Reflect.get(carried, key)
    return typeof value === "string" ? value : undefined
}

/** One public value: `window.__ENV[key]`, then the runtime environment (a computed read Next never inlines), then `fallback`. */
export const readPublicEnv = (key: string, options: PublicEnvReadOptions = {}): string | undefined => {
    checkPublicEnvKeys([key])
    const env = "env" in options ? options.env : processEnv()
    return fromGlobal(options.scope ?? globalThis, key) ?? env?.[key] ?? options.fallback?.[key]
}

/**
 * The one public-config module of an app: `createPublicEnv(["NEXT_PUBLIC_API_URL"], { NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL })`.
 * A key outside the allowlist reads as undefined, never from the environment.
 */
export const createPublicEnv = <Key extends string>(keys: readonly Key[], fallback: Partial<Record<Key, string | undefined>> = {}, options: Omit<PublicEnvReadOptions, "fallback"> = {}): PublicEnvReader<Key> => {
    checkPublicEnvKeys(keys)
    const allowed = new Set<string>(keys)
    return {
        keys,
        publicEnv: (key) => (allowed.has(key) ? readPublicEnv(key, { ...options, fallback }) : undefined),
        script: (source) => publicEnvScript(keys, source),
        scriptProps: (scriptOptions) => publicEnvScriptProps(keys, scriptOptions),
    }
}
