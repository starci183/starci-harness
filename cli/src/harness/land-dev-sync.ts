import { devSync } from "../core/dev/sync.js"
import type { DevSyncRequest } from "../core/dev/sync.js"
import type { DevSyncSettings } from "./local-settings.js"

/**
 * When the batch lander syncs the app's dev checkout: once `debounceMs` passed since the last batch that landed, so consecutive batches give
 * one sync after the last of them. Pure state over the times the lander hands it.
 */
export class LandDebounce {
    private lastLanded: number | undefined = undefined

    public constructor(private readonly debounceMs: number) {}

    /** A batch landed on dev at `now`. */
    public landed(now: number): void {
        this.lastLanded = now
    }

    /** True when a landed batch waits for its sync. */
    public get pending(): boolean {
        return this.lastLanded !== undefined
    }

    /** True when the sync is due at `now`: a batch landed and none landed inside the window since. */
    public due(now: number): boolean {
        return this.lastLanded !== undefined && now - this.lastLanded >= this.debounceMs
    }

    /** How long from `now` until the sync is due (0 when due), or undefined when nothing waits. */
    public waitMs(now: number): number | undefined {
        return this.lastLanded === undefined ? undefined : Math.max(0, this.lastLanded + this.debounceMs - now)
    }

    /** The sync ran (or was given up): nothing waits any more. */
    public settle(): void {
        this.lastLanded = undefined
    }
}

/** The sync the lander runs: `dev sync --execute` on the checkout the settings name (else the lander's app main checkout). */
export type LandSync = (request: DevSyncRequest) => Promise<{ readonly exitCode?: number; readonly message: string }>

/** The auto-sync of a lander: undefined when this machine's local settings leave it off (the default) or the lander only merges. */
export interface LandAutoSync {
    readonly debounce: LandDebounce
    /** Runs the sync now and settles the debounce; a failure is said, never thrown: the lander keeps landing. */
    readonly run: () => Promise<void>
}

/** The lander's auto-sync from this machine's settings (`devSync.afterLand`), or undefined when it is off or the run is a dry run. */
export const landAutoSync = (settings: DevSyncSettings, repo: string, dryRun: boolean, say: (line: string) => void, sync: LandSync = devSync): LandAutoSync | undefined => {
    if (!settings.afterLand || dryRun) return undefined
    const debounce = new LandDebounce(settings.debounceSeconds * 1000)
    const checkout = settings.checkout ?? repo
    const run = async (): Promise<void> => {
        debounce.settle()
        say(`dev sync of ${checkout} after the landed batch(es) (local setting devSync.afterLand)`)
        try {
            const result = await sync({ checkout, local: settings.local, env: settings.env, execute: true, restart: true, processes: settings.processes, say: (line) => { say(`dev sync: ${line}`) } })
            if ((result.exitCode ?? 0) !== 0) say("dev sync: the restart failed; the lander keeps landing (read the stack log, then run starci dev sync --execute by hand)")
        } catch (error) {
            say(`dev sync: not run (${error instanceof Error ? error.message : String(error)}); the lander keeps landing`)
        }
    }
    return { debounce, run }
}
