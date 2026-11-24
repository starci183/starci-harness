import { captureGit } from "../shared/git.js"
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

/**
 * The lander's auto-sync from this machine's settings (`devSync.afterLand`), or undefined when it is off or the run is a dry run. `reload` reads the
 * settings again when the sync runs, so the `local` overlay a dev publish wrote after the lander started is the one installed.
 */
export const landAutoSync = (settings: DevSyncSettings, repo: string, dryRun: boolean, say: (line: string) => void, sync: LandSync = devSync, reload: () => DevSyncSettings = () => settings): LandAutoSync | undefined => {
    if (!settings.afterLand || dryRun) return undefined
    const debounce = new LandDebounce(settings.debounceSeconds * 1000)
    const checkout = settings.checkout ?? repo
    const run = async (): Promise<void> => {
        debounce.settle()
        say(`dev sync of ${checkout} after the landed batch(es) (local setting devSync.afterLand)`)
        try {
            const result = await sync({ checkout, local: reload().local, env: settings.env, execute: true, restart: true, processes: settings.processes, say: (line) => { say(`dev sync: ${line}`) } })
            if ((result.exitCode ?? 0) !== 0) say("dev sync: the restart failed; the lander keeps landing (read the stack log, then run starci dev sync --execute by hand)")
        } catch (error) {
            say(`dev sync: not run (${error instanceof Error ? error.message : String(error)}); the lander keeps landing`)
        }
    }
    return { debounce, run }
}

/**
 * The harness lander's dev publish after a landed batch (`devSync.publishLocal`): undefined when it is off or the run is a dry run. It runs `publish`
 * on the landed dev commit before the debounced sync, so the sync installs the versions it wrote into `devSync.local`; a failure is said, never thrown,
 * and the next landed batch measures from the last publish that completed, so nothing it missed is lost.
 */
export const landPublishDev = (settings: DevSyncSettings, dryRun: boolean, say: (line: string) => void, publish: (landed: string) => Promise<{ readonly published: readonly string[]; readonly local: readonly string[]; readonly failed?: readonly { readonly package: string; readonly version: string; readonly reason: string }[] }>): ((landed: string) => Promise<void>) | undefined => {
    if (!settings.publishLocal || dryRun) return undefined
    return async (landed) => {
        try {
            const done = await publish(landed)
            const failed = (done.failed ?? []).map((failure) => `${failure.package}@${failure.version} (${failure.reason})`)
            say(`dev publish of ${landed.slice(0, 10)}: ${String(done.published.length)} dev build(s); devSync.local = ${done.local.join(", ") || "(empty)"}${failed.length === 0 ? "" : `; FAILED ${failed.join("; ")}: the next batch makes them again from the last complete publish`}`)
        } catch (error) {
            say(`dev publish of ${landed.slice(0, 10)}: not done (${error instanceof Error ? error.message.split("\n")[0] ?? "" : String(error)}); the lander keeps landing, the next batch publishes from the last completed publish (or run starci deps publish-dev --execute)`)
        }
    }
}

/** How often an idle lander looks whether its dev checkout fell behind origin/dev. */
export const BEHIND_CHECK_MS = 5 * 60_000

/**
 * True when the dev checkout is behind origin/dev (a batch landed that no sync of this checkout followed: a lander restarted inside the debounce
 * window, a refused sync, a push from elsewhere). The lander schedules its sync from this state as well as from the batches it lands itself, so a
 * landed commit never waits for the next batch to reach dev. A fetch that fails, or a checkout that is not an ancestor of origin/dev, is false
 * (the sync itself refuses those loudly).
 */
export const checkoutBehindDev = async (checkout: string): Promise<boolean> => {
    const fetched = await captureGit(["fetch", "--quiet", "origin", "dev"], checkout)
    if (fetched.exitCode !== 0) return false
    const head = await captureGit(["rev-parse", "HEAD"], checkout)
    const dev = await captureGit(["rev-parse", "origin/dev"], checkout)
    if (head.exitCode !== 0 || dev.exitCode !== 0 || head.stdout.trim() === dev.stdout.trim()) return false
    return (await captureGit(["merge-base", "--is-ancestor", head.stdout.trim(), dev.stdout.trim()], checkout)).exitCode === 0
}
