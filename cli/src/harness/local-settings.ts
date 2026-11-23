import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"
import { sharedStateBase } from "./ledger.js"

/**
 * The settings of this machine alone: `<shared state base>/local-settings.json` (the harness main checkout's `.runtime/`, git-ignored, or
 * STARCI_LOCAL_ROOT), never committed and never read by CI. Today it holds the dev flow of the batch lander (`devSync`): whether a landed
 * batch runs `starci dev sync` on the app's main dev checkout, and how. An absent file is every default (auto-sync off).
 */
export const LOCAL_SETTINGS_FILE = "local-settings.json"

const devSyncSchema = z.object({
    /** After a batch lands on dev, run `dev sync --execute` on the app's main dev checkout (default off). */
    afterLand: z.boolean().default(false),
    /** The dev checkout to sync (default: the lander's app main checkout). */
    checkout: z.string().min(1).optional(),
    /** The dev environment of the running stack whose api and web are restarted (default dev). */
    env: z.string().min(1).default("dev"),
    /** Consecutive landed batches inside this window give one sync, after the last of them (default 120 s). */
    debounceSeconds: z.number().int().min(0).default(120),
    /** Harness packages the sync keeps installed from the local registry (`dev sync --local <pkg>`, or `<pkg>@<exact version>`); empty restores the registry versions. The harness lander's dev publish writes it. */
    local: z.array(z.string().min(1)).default([]),
    /**
     * The harness's own lander only: after a batch lands on the harness's dev, publish its dev line (`deps publish-dev --execute`: the changed packages and
     * their dependents as X.Y.Z-dev.N) and set `local` to exactly those versions, before the sync (default off).
     */
    publishLocal: z.boolean().default(false),
    /** The stack processes of each side: a change under be/ restarts `be`, under fe/ restarts `fe`, anything else both. */
    processes: z.object({ be: z.array(z.string().min(1)).default(["api"]), fe: z.array(z.string().min(1)).default(["web"]) }).default({ be: ["api"], fe: ["web"] }),
    /**
     * Per repository a lander lands for (key: the repository path it runs in, e.g. D:/Repositories/starci-next-app): its own dev checkout and
     * overrides of afterLand, env, debounceSeconds and processes. With any entry here, a repository without one syncs nothing, so a lander never
     * syncs another app's checkout; without entries the top-level `checkout` is the single app's (a one-app machine).
     */
    repos: z
        .record(
            z.string().min(1),
            z.object({
                afterLand: z.boolean().default(true),
                checkout: z.string().min(1).optional(),
                env: z.string().min(1).optional(),
                debounceSeconds: z.number().int().min(0).optional(),
                processes: z.object({ be: z.array(z.string().min(1)).default(["api"]), fe: z.array(z.string().min(1)).default(["web"]) }).optional(),
            }),
        )
        .default({}),
})

const settingsSchema = z.object({
    schema: z.literal("starci/local-settings@1").default("starci/local-settings@1"),
    devSync: devSyncSchema.default(devSyncSchema.parse({})),
})

/** The dev flow settings of this machine. */
export type DevSyncSettings = z.infer<typeof devSyncSchema>

/** This machine's settings. */
export type LocalSettings = z.infer<typeof settingsSchema>

/** Where this machine's settings live. */
export const localSettingsPath = (base: string = sharedStateBase()): string => join(base, LOCAL_SETTINGS_FILE)

/**
 * Sets `devSync.local` of the settings file to exactly `entries`, keeping every other key of the file as it is (an absent file is created). The written
 * file is read back through the schema, so a damaged one refuses LOCAL_SETTINGS_INVALID instead of being overwritten.
 */
export const writeDevSyncLocal = (file: string, entries: readonly string[]): void => {
    loadLocalSettings(file)
    const raw: unknown = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}
    const record = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
    const devSync = typeof record.devSync === "object" && record.devSync !== null && !Array.isArray(record.devSync) ? (record.devSync as Record<string, unknown>) : {}
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify({ ...record, devSync: { ...devSync, local: [...entries] } }, null, 2)}\n`)
    loadLocalSettings(file)
}

const repoKey = (path: string): string => path.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()

/**
 * The dev sync settings the lander of `repo` uses: the machine-wide ones with that repository's entry laid over them (its own checkout, env,
 * debounce, processes; `local` and `publishLocal` stay machine-wide). With entries listed and none for `repo`, afterLand is off: a lander never
 * syncs a checkout that is not its own app's. Pure.
 */
export const devSyncForRepo = (settings: DevSyncSettings, repo: string): DevSyncSettings => {
    const entries = Object.entries(settings.repos)
    if (entries.length === 0) return settings
    const own = entries.find(([key]) => repoKey(key) === repoKey(repo))?.[1]
    if (own === undefined) return { ...settings, afterLand: false, checkout: undefined }
    return { ...settings, afterLand: own.afterLand, checkout: own.checkout, env: own.env ?? settings.env, debounceSeconds: own.debounceSeconds ?? settings.debounceSeconds, processes: own.processes ?? settings.processes }
}

/** Reads this machine's settings; an absent file is every default, a damaged one is LOCAL_SETTINGS_INVALID naming the file. */
export const loadLocalSettings = (file: string = localSettingsPath()): LocalSettings => {
    if (!existsSync(file)) return settingsSchema.parse({})
    let raw: unknown
    try {
        raw = JSON.parse(readFileSync(file, "utf8"))
    } catch (error) {
        throw new Refusal("LOCAL_SETTINGS_INVALID", `${file} is not JSON (${error instanceof Error ? error.message : String(error)})`)
    }
    const parsed = settingsSchema.safeParse(raw)
    if (!parsed.success) throw new Refusal("LOCAL_SETTINGS_INVALID", `${file}: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`)
    return parsed.data
}
