import { readFile } from "node:fs/promises"
import { dirname, extname, resolve } from "node:path"
import { parse as parseYaml } from "yaml"
import { AiRouterError } from "../errors.ts"
import type { KeyConfig, PoolConfig } from "../types.ts"

/** A secret named by reference: an environment variable or a file (a mounted Docker or Kubernetes secret), never its value. */
export type SecretRef = { readonly env: string } | { readonly file: string }

/** Where the gateway keeps virtual keys: in memory (lost on restart) or in a SQLite file. */
export type KeyStoreConfig = { readonly type: "memory" } | { readonly type: "sqlite"; readonly path: string }

/** The `gateway` section of a config file, with every default applied and paths resolved from the file's folder. */
export interface GatewaySettings {
    readonly port: number
    readonly host: string
    readonly maxBodyBytes: number
    readonly adminToken: SecretRef | null
    readonly keyStore: KeyStoreConfig
}

/** A loaded config file: the pool the router takes, and the gateway's settings. */
export interface GatewayFileConfig {
    readonly pool: PoolConfig
    readonly gateway: GatewaySettings
}

type Schema =
    | "string"
    | "number"
    | "boolean"
    | "number|null"
    | { readonly enum: readonly string[] }
    | { readonly list: Schema }
    | { readonly map: Schema }
    | { readonly fields: Readonly<Record<string, Schema>>; readonly required?: readonly string[] }

const CAPABILITIES: Schema = { list: { enum: ["chat", "streaming", "tools", "json", "embeddings", "vision"] } }
const BREAKER: Schema = { fields: { failureThreshold: "number", cooldownMs: "number", maxCooldownMs: "number" } }
const POLICY: Schema = {
    fields: {
        model: "string",
        fallbacks: { list: "string" },
        allowFallback: "boolean",
        maxAttempts: "number",
        timeoutMs: "number",
        deadlineMs: "number",
        budget: { fields: { maxCost: "number" } },
        providers: { list: "string" },
        require: CAPABILITIES,
    },
}
const SECRET: Schema = { fields: { env: "string", file: "string" } }
const FILE: Schema = {
    fields: {
        gateway: {
            fields: {
                port: "number",
                host: "string",
                maxBodyBytes: "number",
                adminToken: SECRET,
                keyStore: { fields: { type: { enum: ["memory", "sqlite"] }, path: "string" }, required: ["type"] },
            },
        },
        providers: {
            list: {
                fields: {
                    id: "string",
                    baseUrl: "string",
                    headers: { map: "string" },
                    weight: "number",
                    maxConcurrency: "number",
                    keys: { list: { fields: { alias: "string", env: "string", file: "string", weight: "number", maxConcurrency: "number" }, required: ["alias"] } },
                    models: {
                        list: {
                            fields: {
                                id: "string",
                                aliases: { list: "string" },
                                contextWindow: "number",
                                cost: { fields: { input: "number", output: "number" }, required: ["input", "output"] },
                                capabilities: CAPABILITIES,
                                weight: "number",
                            },
                            required: ["id"],
                        },
                    },
                },
                required: ["id", "baseUrl", "keys", "models"],
            },
        },
        defaults: POLICY,
        profiles: { map: POLICY },
        resilience: {
            fields: {
                keyBreaker: BREAKER,
                providerBreaker: BREAKER,
                backoff: { fields: { baseMs: "number", factor: "number", maxMs: "number" } },
                authDisableMs: "number|null",
                rateLimitCooldownMs: "number",
            },
        },
        selection: { fields: { latencyTolerance: "number", latencySlackMs: "number", ewmaAlpha: "number", lowHeadroom: "number" } },
        telemetry: { fields: { includeContent: "boolean" } },
        storeNamespace: "string",
    },
    required: ["providers"],
}

/** Field names that would hold a secret's value; a config file names secrets by reference only. */
const INLINE_SECRET = /^(?:value|key|secret|token|apikey|api_key|password)$/i
const SECRET_HEADER = /authorization|api[-_]?key|token|secret|cookie/i

function configError(message: string): AiRouterError {
    return new AiRouterError({ errorClass: "config", message })
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function check(value: unknown, schema: Schema, where: string): void {
    if (schema === "string") {
        if (typeof value !== "string") throw configError(`${where} must be a string`)
        return
    }
    if (schema === "number" || schema === "number|null") {
        if (schema === "number|null" && value === null) return
        if (typeof value !== "number" || !Number.isFinite(value)) throw configError(`${where} must be a number`)
        return
    }
    if (schema === "boolean") {
        if (typeof value !== "boolean") throw configError(`${where} must be true or false`)
        return
    }
    if ("enum" in schema) {
        if (typeof value !== "string" || !schema.enum.includes(value)) throw configError(`${where} must be one of ${schema.enum.join(", ")}`)
        return
    }
    if ("list" in schema) {
        if (!Array.isArray(value)) throw configError(`${where} must be a list`)
        value.forEach((item: unknown, index) => {
            check(item, schema.list, `${where}[${String(index)}]`)
        })
        return
    }
    if (!isRecord(value)) throw configError(`${where} must be a mapping`)
    if ("map" in schema) {
        for (const [name, item] of Object.entries(value)) check(item, schema.map, `${where}.${name}`)
        return
    }
    for (const [name, item] of Object.entries(value)) {
        const field = schema.fields[name]
        if (field === undefined) {
            if (INLINE_SECRET.test(name)) throw configError(`${where}.${name} would hold a secret: name it by reference ({ env: NAME } or { file: path }), never inline`)
            throw configError(`${where}.${name} is not a known field`)
        }
        if (item !== undefined) check(item, field, `${where}.${name}`)
    }
    for (const name of schema.required ?? []) if (value[name] === undefined) throw configError(`${where}.${name} is required`)
}

function secretRef(value: { readonly env?: unknown; readonly file?: unknown }, where: string, base: string): SecretRef {
    const { env, file } = value
    if (typeof env === "string" && file === undefined) return { env }
    if (typeof file === "string" && env === undefined) return { file: resolve(base, file) }
    throw configError(`${where} needs exactly one of env or file`)
}

/** Reads a referenced secret now: the variable's value or the file's first line, trimmed; undefined when absent or empty. */
export async function readSecret(ref: SecretRef, env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
    let value: string | undefined
    if ("env" in ref) value = env[ref.env]
    else {
        try {
            value = (await readFile(ref.file, "utf8")).split(/\r?\n/)[0]
        } catch {
            value = undefined
        }
    }
    const trimmed = value?.trim()
    return trimmed === undefined || trimmed === "" ? undefined : trimmed
}

/**
 * Validates a parsed config file and turns it into a pool and gateway settings. Upstream keys stay references: `env`
 * keys go to the router as they are, `file` keys become resolvers that read the file at each attempt (rotation needs
 * no restart). A field that would hold a secret's value, or a provider header that would carry one, is refused.
 */
export function parseGatewayConfig(raw: unknown, base: string = process.cwd()): GatewayFileConfig {
    check(raw, FILE, "config")
    const file = raw as Record<string, unknown> & { providers: Record<string, unknown>[]; gateway?: Record<string, unknown> }
    const providers = file.providers.map((provider, index) => {
        const where = `config.providers[${String(index)}]`
        for (const name of Object.keys(isRecord(provider.headers) ? provider.headers : {})) {
            if (SECRET_HEADER.test(name)) throw configError(`${where}.headers.${name} would carry a secret in the config file; give keys under keys[] by reference`)
        }
        const keys = (provider.keys as Record<string, unknown>[]).map((key, at): KeyConfig => {
            const ref = secretRef({ env: key.env, file: key.file }, `${where}.keys[${String(at)}]`, base)
            const common = {
                alias: key.alias as string,
                ...(key.weight === undefined ? {} : { weight: key.weight as number }),
                ...(key.maxConcurrency === undefined ? {} : { maxConcurrency: key.maxConcurrency as number }),
            }
            return "env" in ref ? { ...common, env: ref.env } : { ...common, resolve: () => readSecret(ref) }
        })
        return { ...provider, keys }
    })
    const gateway = file.gateway ?? {}
    const store = (gateway.keyStore ?? { type: "memory" }) as { type: "memory" | "sqlite"; path?: string }
    if (store.type === "sqlite" && store.path === undefined) throw configError("config.gateway.keyStore.path is required for a sqlite store")
    const port = (gateway.port as number | undefined) ?? 8080
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw configError("config.gateway.port must be a port number")
    const maxBodyBytes = (gateway.maxBodyBytes as number | undefined) ?? 4 * 1024 * 1024
    if (!Number.isInteger(maxBodyBytes) || maxBodyBytes <= 0) throw configError("config.gateway.maxBodyBytes must be a positive integer")
    const pool: Record<string, unknown> = { ...file, providers }
    delete pool.gateway
    return {
        pool: pool as unknown as PoolConfig,
        gateway: {
            port,
            host: (gateway.host as string | undefined) ?? "127.0.0.1",
            maxBodyBytes,
            adminToken: isRecord(gateway.adminToken) ? secretRef(gateway.adminToken, "config.gateway.adminToken", base) : null,
            keyStore: store.type === "sqlite" ? { type: "sqlite", path: store.path === ":memory:" ? ":memory:" : resolve(base, store.path ?? "") } : { type: "memory" },
        },
    }
}

/** Reads a YAML or JSON config file (by extension; anything but `.json` is read as YAML) and parses it. */
export async function loadGatewayConfig(path: string): Promise<GatewayFileConfig> {
    const full = resolve(path)
    let text: string
    try {
        text = await readFile(full, "utf8")
    } catch {
        throw configError(`cannot read the config file ${full}`)
    }
    let raw: unknown
    try {
        raw = extname(full).toLowerCase() === ".json" ? JSON.parse(text) : parseYaml(text)
    } catch (error) {
        throw configError(`the config file ${full} does not parse: ${error instanceof Error ? error.message : "unknown error"}`)
    }
    return parseGatewayConfig(raw, dirname(full))
}
