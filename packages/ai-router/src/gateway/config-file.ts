import { readFile } from "node:fs/promises"
import { dirname, extname, resolve } from "node:path"
import { parse as parseYaml } from "yaml"
import { AiRouterError } from "../errors.ts"
import { keysFromEnv } from "../env.ts"
import { PROVIDER_PRESETS } from "../providers.ts"
import type { KeyConfig, PoolConfig } from "../types.ts"

/** A secret named by reference: an environment variable or a file (a mounted Docker or Kubernetes secret), never its value. */
export type SecretRef = { readonly env: string } | { readonly file: string }

/** Where the gateway keeps virtual keys: in memory (lost on restart) or in a SQLite file. */
export type KeyStoreConfig = { readonly type: "memory" } | { readonly type: "sqlite"; readonly path: string }

/** Where the pool keeps breakers, blacklists, headroom and budgets: in memory (a restart forgets them) or in a SQLite file. */
export type StateStoreConfig = KeyStoreConfig

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
    /** The pool's state store; `serveGateway` opens it and hands it to the router. */
    readonly stateStore: StateStoreConfig
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
    | { readonly anyOf: readonly Schema[] }

const CAPABILITIES: Schema = { list: { enum: ["chat", "streaming", "tools", "json", "embeddings", "vision"] } }
const BREAKER: Schema = { fields: { failureThreshold: "number", cooldownMs: "number", maxCooldownMs: "number" } }
const CANDIDATE: Schema = { fields: { model: "string", provider: "string", weight: "number" }, required: ["model"] }
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
        candidates: { list: { anyOf: [CANDIDATE, { list: CANDIDATE }] } },
        pinned: "boolean",
    },
}
const SECRET: Schema = { fields: { env: "string", file: "string" } }
const STORE: Schema = { fields: { type: { enum: ["memory", "sqlite"] }, path: "string" }, required: ["type"] }
const FILE: Schema = {
    fields: {
        gateway: {
            fields: {
                port: "number",
                appPort: "number",
                portOffset: "number",
                host: "string",
                maxBodyBytes: "number",
                adminToken: SECRET,
                keyStore: STORE,
            },
        },
        providers: {
            list: {
                fields: {
                    id: "string",
                    kind: { enum: Object.keys(PROVIDER_PRESETS) },
                    baseUrl: "string",
                    defaultMaxTokens: "number",
                    budget: { fields: { costPerDay: "number", costPerMonth: "number" } },
                    keysFromEnv: "string",
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
                                identity: "string",
                                dimensions: "number",
                            },
                            required: ["id"],
                        },
                    },
                },
                required: ["id", "models"],
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
                quotaBlacklistMs: "number",
            },
        },
        selection: { fields: { latencyTolerance: "number", latencySlackMs: "number", ewmaAlpha: "number", lowHeadroom: "number" } },
        telemetry: { fields: { includeContent: "boolean" } },
        storeNamespace: "string",
        stateStore: STORE,
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
    if ("anyOf" in schema) {
        const errors: string[] = []
        for (const option of schema.anyOf) {
            try {
                check(value, option, where)
                return
            } catch (error) {
                errors.push(error instanceof Error ? error.message : String(error))
            }
        }
        throw configError(errors[0] ?? `${where} matches no allowed shape`)
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
 * no restart); `keysFromEnv: PREFIX` finds the canonical `PREFIX_API_KEY`, `_2`, ... variables in `env` (src/env.ts).
 * A field that would hold a secret's value, or a provider header that would carry one, is refused.
 */
export function parseGatewayConfig(raw: unknown, base: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): GatewayFileConfig {
    check(raw, FILE, "config")
    const file = raw as Record<string, unknown> & { providers: Record<string, unknown>[]; gateway?: Record<string, unknown> }
    const providers = file.providers.map((provider, index) => {
        const where = `config.providers[${String(index)}]`
        for (const name of Object.keys(isRecord(provider.headers) ? provider.headers : {})) {
            if (SECRET_HEADER.test(name)) throw configError(`${where}.headers.${name} would carry a secret in the config file; give keys under keys[] by reference`)
        }
        const listed = Array.isArray(provider.keys) ? provider.keys.filter(isRecord) : []
        const prefix = typeof provider.keysFromEnv === "string" ? provider.keysFromEnv : undefined
        if (prefix === undefined && listed.length === 0) throw configError(`${where} needs keys or keysFromEnv`)
        const fromEnv = prefix === undefined ? [] : keysFromEnv(prefix, String(provider.id), env)
        const declared = listed.map((key, at): KeyConfig => {
            const ref = secretRef({ env: key.env, file: key.file }, `${where}.keys[${String(at)}]`, base)
            const common = {
                alias: key.alias as string,
                ...(key.weight === undefined ? {} : { weight: key.weight as number }),
                ...(key.maxConcurrency === undefined ? {} : { maxConcurrency: key.maxConcurrency as number }),
            }
            return "env" in ref ? { ...common, env: ref.env } : { ...common, resolve: () => readSecret(ref) }
        })
        const rest = Object.fromEntries(Object.entries(provider).filter(([field]) => field !== "keysFromEnv"))
        return { ...rest, keys: [...declared, ...fromEnv] }
    })
    const gateway = file.gateway ?? {}
    const store = (gateway.keyStore ?? { type: "memory" }) as { type: "memory" | "sqlite"; path?: string }
    if (store.type === "sqlite" && store.path === undefined) throw configError("config.gateway.keyStore.path is required for a sqlite store")
    const appPort = gateway.appPort as number | undefined
    const portOffset = gateway.portOffset as number | undefined
    if (gateway.port !== undefined && (appPort !== undefined || portOffset !== undefined)) throw configError("config.gateway.port cannot be combined with appPort or portOffset")
    if (appPort === undefined && portOffset !== undefined) throw configError("config.gateway.portOffset needs config.gateway.appPort")
    if (appPort !== undefined && (!Number.isInteger(appPort) || appPort < 1 || appPort > 65535)) throw configError("config.gateway.appPort must be a port number")
    if (portOffset !== undefined && (!Number.isInteger(portOffset) || portOffset < 1)) throw configError("config.gateway.portOffset must be an integer of 1 or more")
    const port = appPort === undefined ? ((gateway.port as number | undefined) ?? 8080) : appPort + (portOffset ?? 1)
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw configError(appPort === undefined ? "config.gateway.port must be a port number" : "config.gateway.appPort + portOffset must be a port number")
    const maxBodyBytes = (gateway.maxBodyBytes as number | undefined) ?? 4 * 1024 * 1024
    if (!Number.isInteger(maxBodyBytes) || maxBodyBytes <= 0) throw configError("config.gateway.maxBodyBytes must be a positive integer")
    const pool: Record<string, unknown> = { ...file, providers }
    delete pool.gateway
    delete pool.stateStore
    const state = storeOf(file.stateStore, "config.stateStore", base)
    return {
        stateStore: state,
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

/** A store setting with its path resolved from the config file's folder; memory when absent. */
function storeOf(value: unknown, where: string, base: string): StateStoreConfig {
    if (!isRecord(value) || value.type !== "sqlite") return { type: "memory" }
    if (typeof value.path !== "string") throw configError(`${where}.path is required for a sqlite store`)
    return { type: "sqlite", path: value.path === ":memory:" ? ":memory:" : resolve(base, value.path) }
}

/** Reads a YAML or JSON config file (by extension; anything but `.json` is read as YAML) and parses it. */
export async function loadGatewayConfig(path: string, env: NodeJS.ProcessEnv = process.env): Promise<GatewayFileConfig> {
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
    return parseGatewayConfig(raw, dirname(full), env)
}
