import { createConnection } from "node:net"
import { setTimeout as sleep } from "node:timers/promises"
import { Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { WRITERS, defineVerb } from "../../shared/verb.js"
import { loadSlotRules, slotRoot, withSlot } from "../../harness/slots.js"
import { laneHolder, positiveInt, waitSeconds } from "../slot/holder.js"
import { runArgv } from "../slot/run.js"

/** How long --ready-url has to answer, by default. */
const SERVE_TIMEOUT_S = 180

/** Whether something listens on 127.0.0.1:`port`. */
const listening = (port: number): Promise<boolean> =>
    new Promise((settle) => {
        const socket = createConnection({ host: "127.0.0.1", port })
        socket.setTimeout(2000)
        socket.once("connect", () => {
            socket.destroy()
            settle(true)
        })
        socket.once("error", () => {
            settle(false)
        })
        socket.once("timeout", () => {
            socket.destroy()
            settle(false)
        })
    })

/** Whether `url` answers 200. */
const answers = async (url: string): Promise<boolean> => {
    try {
        return (await fetch(url, { signal: AbortSignal.timeout(5000) })).status === 200
    } catch {
        return false
    }
}

/** Polls `test` every 3 s for `seconds`; true once it holds. */
const waitFor = async (test: () => Promise<boolean>, seconds: number): Promise<boolean> => {
    const until = Date.now() + seconds * 1000
    for (;;) {
        if (await test()) return true
        if (Date.now() >= until) return false
        await sleep(3000)
    }
}

/**
 * `starci gallery shoot -- <capture command...>`: shoot the gallery at 1440 and 390 under a machine-wide shoot slot, against the app's ONE running
 * web server, the shared dev stack's (contexts/authority/lanes.md "Shots"): a lane never starts a web or api server of its own to shoot or look.
 * It waits for `--ready-url` (the api the screens read) and for the slot (one of the host's heavy jobs, ops/slots.yaml maxHeavy), refuses when
 * nothing listens on `--port`, runs the app's own capture command with `{port}` and `{url}` filled in and releases the slot, however the shoot
 * ends. The run is recorded with its launchers, so a shoot whose caller died is stopped by the reaper (harness/runs.ts), browser and all.
 */
export const galleryShootVerb = defineVerb({
    path: ["gallery", "shoot"],
    summary: "shoot the gallery under a machine-wide shoot slot (one of the host's maxHeavy heavy jobs) against the app's one running web server, the shared dev stack's: wait for --ready-url and the slot, refuse when nothing listens on --port (a lane never starts its own web or api server), run the app's capture command ({port}, {url} filled in), release the slot; a shoot whose caller died is stopped by the reaper",
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/gallery-shoot@1",
    flags: {
        command: { kind: "rest", summary: "the app's capture command and its arguments, after -- ({port} and {url} are replaced)", required: true },
        port: { kind: "string", summary: "the port the shared dev stack's web server listens on ({port}; {url} is http://localhost:<port>)" },
        "ready-url": { kind: "string", summary: "a URL that must answer 200 before the slot is taken (the api the screens read)" },
        timeout: { kind: "string", summary: "seconds --ready-url has to answer (default 180)" },
        lane: { kind: "string", summary: "the lane that holds the slot (default: STARCI_LANE, else the branch lane/<lane>)" },
        wait: { kind: "string", summary: "seconds to wait for a shoot slot before SLOT_BUSY (default: until one frees)" },
        dir: { kind: "string", summary: "the slot root (default: STARCI_LANES_DIR, else slots.root of ops/slots.yaml, else <harness state>/slots)" },
    },
    run: async (context, flags) => {
        const say = context.progress
        const root = await repositoryRoot(context.cwd)
        const lane = await laneHolder(root, flags.lane)
        const port = positiveInt("port", flags.port)
        const timeout = positiveInt("timeout", flags.timeout) ?? SERVE_TIMEOUT_S
        const fill = (text: string): string => (port === undefined ? text : text.replaceAll("{port}", String(port)).replaceAll("{url}", `http://localhost:${String(port)}`))
        const capture = flags.command.map(fill)
        if (flags["ready-url"] !== undefined) {
            say(`waiting for ${flags["ready-url"]}`)
            if (!(await waitFor(() => answers(flags["ready-url"] ?? ""), timeout))) throw new Refusal("GALLERY_SHOOT_NOT_READY", `${flags["ready-url"]} did not answer 200 within ${String(timeout)} s: the shoot needs the shared dev stack up and never starts it`)
        }
        if (port !== undefined && !(await listening(port))) throw new Refusal("GALLERY_SHOOT_NO_SERVER", `nothing listens on ${String(port)}: a shoot targets the app's one running web server, the shared dev stack's (land, then starci dev sync); a lane never starts its own`)
        const rules = loadSlotRules()
        const slots = slotRoot(flags.dir, rules)
        const outcome = await withSlot(slots, rules, "shoot", lane, { waitSeconds: waitSeconds(flags.wait), say }, async (taken) => {
            say(`shoot slot ${String(taken.n)} held by ${lane}`)
            return { taken, run: await runArgv(capture, root, `gallery shoot ${lane}`, "build") }
        })
        const { run, taken } = outcome
        for (const text of [run.stdout, run.stderr]) if (text !== "") say(text)
        return {
            data: { lane, slot: taken.n, reclaimed: taken.reclaimed, capture, exitCode: run.exitCode, stdout: run.stdout.slice(-4000), stderr: run.stderr.slice(-4000) },
            message: `${capture.join(" ")} exited ${String(run.exitCode)} under shoot slot ${String(taken.n)} (slot released)`,
            exitCode: run.exitCode === 0 ? 0 : 1,
        }
    },
})
