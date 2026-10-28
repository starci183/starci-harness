import { parseArgs } from "node:util"
import { createRouter } from "../router.ts"
import type { FetchLike } from "../types.ts"
import { loadGatewayConfig } from "./config-file.ts"
import { KeyAdmin } from "./keys.ts"
import type { IssuedKey, KeyPatch, KeySpec, KeyUsage, VirtualKey } from "./keys.ts"
import { openKeyStore, serveGateway } from "./serve.ts"

/** What the CLI reads and writes; the bin passes the process's, a spec passes its own. */
export interface CliIo {
    readonly out: (text: string) => void
    readonly err: (text: string) => void
    readonly env: NodeJS.ProcessEnv
    /** Stops `serve`; the bin aborts it on SIGINT and SIGTERM. */
    readonly signal?: AbortSignal
    /** The `fetch` of `keys --url` and of the served router (a spec's fake). Default the global `fetch`. */
    readonly fetch?: FetchLike
}

/** The admin operations, whether run on the store directly or through a running gateway's admin API. */
interface Admin {
    create(spec: KeySpec): Promise<IssuedKey>
    list(): Promise<VirtualKey[]>
    get(id: string): Promise<VirtualKey>
    revoke(id: string): Promise<VirtualKey>
    rotate(id: string): Promise<IssuedKey>
    update(id: string, patch: KeyPatch): Promise<VirtualKey>
    usage(id: string, range: { from?: string; to?: string }): Promise<KeyUsage>
}

/** A usage mistake: the CLI prints the help and exits 2. */
class UsageError extends Error {}

const HELP = `ai-router: an OpenAI-compatible gateway over a pool of providers, keys and models.
Run as: node node_modules/@starci/ai-router/dist/gateway/run.js <command>, or in process with main() from @starci/ai-router/cli.

  serve --config <pool.yaml|json> [--port N] [--host H]
  keys create --label <label> [--owner O] [--profiles a,b] [--models m1,m2] [--no-fallback]
              [--rpm N] [--tokens-per-day N] [--cost-per-day X] [--cost-per-month X] [--disabled]
  keys list
  keys get <id>
  keys update <id> [--owner O] [--profiles ..] [--models ..] [--fallback|--no-fallback]
              [--rpm N] [--tokens-per-day N] [--cost-per-day X] [--cost-per-month X] [--enable|--disable]
  keys revoke <id>
  keys rotate <id>
  keys usage <id> [--from YYYY-MM-DD] [--to YYYY-MM-DD]

keys commands run on the config's durable key store (--config <file>), or on a running gateway's admin API
(--url <gateway url>, the admin token read from the variable --admin-token-env names, AI_ROUTER_ADMIN_TOKEN by default).
Every command prints JSON. A created or rotated key's secret is printed once and never stored.`

const OPTIONS = {
    config: { type: "string" },
    port: { type: "string" },
    host: { type: "string" },
    url: { type: "string" },
    "admin-token-env": { type: "string" },
    label: { type: "string" },
    owner: { type: "string" },
    profiles: { type: "string" },
    models: { type: "string" },
    fallback: { type: "boolean" },
    "no-fallback": { type: "boolean" },
    rpm: { type: "string" },
    "tokens-per-day": { type: "string" },
    "cost-per-day": { type: "string" },
    "cost-per-month": { type: "string" },
    enable: { type: "boolean" },
    disable: { type: "boolean" },
    disabled: { type: "boolean" },
    from: { type: "string" },
    to: { type: "string" },
    help: { type: "boolean", short: "h" },
} as const

type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true; strict: true }>>["values"]

function list(value: string | undefined): string[] | undefined {
    return value?.split(",").map((name) => name.trim()).filter((name) => name !== "")
}

function amount(value: string | undefined, flag: string): number | undefined {
    if (value === undefined) return undefined
    const parsed = Number(value)
    if (value.trim() === "" || !Number.isFinite(parsed)) throw new UsageError(`--${flag} must be a number`)
    return parsed
}

function flag(on: boolean | undefined, off: boolean | undefined, name: string): boolean | undefined {
    if (on === true && off === true) throw new UsageError(`--${name} and its opposite cannot both be given`)
    return on === true ? true : off === true ? false : undefined
}

function bindings(values: Values): KeyPatch {
    const quota: Record<string, number> = {}
    for (const [field, name] of [
        ["requestsPerMinute", "rpm"],
        ["tokensPerDay", "tokens-per-day"],
        ["costPerDay", "cost-per-day"],
        ["costPerMonth", "cost-per-month"],
    ] as const) {
        const limit = amount(values[name], name)
        if (limit !== undefined) quota[field] = limit
    }
    const profiles = list(values.profiles)
    const models = list(values.models)
    const allowFallback = flag(values.fallback, values["no-fallback"], "fallback")
    const enabled = flag(values.enable, values.disable ?? values.disabled, "enable")
    return {
        ...(values.owner === undefined ? {} : { owner: values.owner }),
        ...(profiles === undefined ? {} : { profiles }),
        ...(models === undefined ? {} : { models }),
        ...(allowFallback === undefined ? {} : { allowFallback }),
        ...(Object.keys(quota).length === 0 ? {} : { quota }),
        ...(enabled === undefined ? {} : { enabled }),
    }
}

/** The admin API of a running gateway, spoken over HTTP. */
function remoteAdmin(url: string, token: string, fetchImpl: FetchLike): Admin {
    const base = url.replace(/\/+$/, "")
    async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
        const response = await fetchImpl(`${base}/admin/keys${path}`, {
            method,
            headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        const json: unknown = await response.json()
        if (!response.ok) {
            const error = (json as { error?: { message?: string } }).error
            throw new Error(`the gateway answered ${String(response.status)}: ${error?.message ?? "no message"}`)
        }
        return json as T
    }
    return {
        create: (spec) => call("POST", "", spec),
        list: async () => (await call<{ data: VirtualKey[] }>("GET", "")).data,
        get: (id) => call("GET", `/${encodeURIComponent(id)}`),
        revoke: (id) => call("POST", `/${encodeURIComponent(id)}/revoke`),
        rotate: (id) => call("POST", `/${encodeURIComponent(id)}/rotate`),
        update: (id, patch) => call("PATCH", `/${encodeURIComponent(id)}`, patch),
        usage: (id, range) => {
            const query = new URLSearchParams({ ...(range.from === undefined ? {} : { from: range.from }), ...(range.to === undefined ? {} : { to: range.to }) }).toString()
            return call("GET", `/${encodeURIComponent(id)}/usage${query === "" ? "" : `?${query}`}`)
        },
    }
}

async function openAdmin(values: Values, io: CliIo): Promise<{ admin: Admin; close: () => Promise<void> }> {
    if (values.url !== undefined && values.config !== undefined) throw new UsageError("give --config or --url, not both")
    if (values.url !== undefined) {
        const variable = values["admin-token-env"] ?? "AI_ROUTER_ADMIN_TOKEN"
        const token = io.env[variable]?.trim()
        if (token === undefined || token === "") throw new UsageError(`the admin token variable ${variable} is not set`)
        return { admin: remoteAdmin(values.url, token, io.fetch ?? ((input, init) => fetch(input, init))), close: () => Promise.resolve() }
    }
    if (values.config === undefined) throw new UsageError("keys commands need --config <file> or --url <gateway url>")
    const file = await loadGatewayConfig(values.config)
    if (file.gateway.keyStore.type === "memory") {
        throw new UsageError("the config keeps keys in memory, which only the running gateway holds: use --url <gateway url> instead")
    }
    // The router is built for its catalog only, so a key can name only the pool's profiles and models; nothing is sent.
    const catalog = createRouter(file.pool).catalog()
    const store = await openKeyStore(file.gateway.keyStore)
    return {
        admin: new KeyAdmin(store, { catalog }),
        close: async () => {
            await store.close?.()
        },
    }
}

async function keys(command: string | undefined, id: string | undefined, values: Values, io: CliIo): Promise<unknown> {
    const needsId = (): string => {
        if (id === undefined) throw new UsageError(`keys ${command ?? ""} needs a key id`)
        return id
    }
    const known = ["create", "list", "get", "update", "revoke", "rotate", "usage"]
    if (command === undefined || !known.includes(command)) throw new UsageError(`keys needs one of ${known.join(", ")}`)
    if (command === "create" && values.label === undefined) throw new UsageError("keys create needs --label")
    const { admin, close } = await openAdmin(values, io)
    try {
        switch (command) {
            case "create":
                return await admin.create({ label: values.label ?? "", ...bindings(values) })
            case "list":
                return await admin.list()
            case "get":
                return await admin.get(needsId())
            case "update":
                return await admin.update(needsId(), bindings(values))
            case "revoke":
                return await admin.revoke(needsId())
            case "rotate":
                return await admin.rotate(needsId())
            default:
                return await admin.usage(needsId(), { ...(values.from === undefined ? {} : { from: values.from }), ...(values.to === undefined ? {} : { to: values.to }) })
        }
    } finally {
        await close()
    }
}

async function serve(values: Values, io: CliIo): Promise<void> {
    if (values.config === undefined) throw new UsageError("serve needs --config <file>")
    const port = amount(values.port, "port")
    const serving = await serveGateway({
        config: values.config,
        env: io.env,
        ...(port === undefined ? {} : { port }),
        ...(values.host === undefined ? {} : { host: values.host }),
        ...(io.fetch === undefined ? {} : { fetch: io.fetch }),
        onError: (error) => {
            io.err(`ai-router: ${error instanceof Error ? error.message : "an unknown failure"}\n`)
        },
    })
    io.out(`${JSON.stringify({ listening: serving.url })}\n`)
    await new Promise<void>((resolve) => {
        if (io.signal === undefined) return
        if (io.signal.aborted) resolve()
        else
            io.signal.addEventListener(
                "abort",
                () => {
                    resolve()
                },
                { once: true },
            )
    })
    await serving.close()
}

/** Runs one CLI command and resolves to its exit code: 0 done, 1 failed, 2 misused. */
export async function main(argv: readonly string[], io: CliIo): Promise<number> {
    let parsed: { values: Values; positionals: string[] }
    try {
        parsed = parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true, strict: true })
    } catch (error) {
        io.err(`ai-router: ${error instanceof Error ? error.message : "bad arguments"}\n\n${HELP}\n`)
        return 2
    }
    const { values, positionals } = parsed
    const [group, command, id] = positionals
    if (values.help === true || group === undefined) {
        io.out(`${HELP}\n`)
        return group === undefined && values.help !== true ? 2 : 0
    }
    try {
        if (group === "serve") {
            await serve(values, io)
            return 0
        }
        if (group === "keys") {
            io.out(`${JSON.stringify(await keys(command, id, values, io), null, 2)}\n`)
            return 0
        }
        throw new UsageError(`unknown command "${group}"`)
    } catch (error) {
        if (error instanceof UsageError) {
            io.err(`ai-router: ${error.message}\n\n${HELP}\n`)
            return 2
        }
        io.err(`ai-router: ${error instanceof Error ? error.message : "an unknown failure"}\n`)
        return 1
    }
}
