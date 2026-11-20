import { spawn } from "node:child_process"
import { closeSync, mkdirSync, openSync } from "node:fs"
import { createConnection } from "node:net"
import { join, resolve } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { Refusal } from "../../shared/errors.js"
import { killPidTree, pidAlive } from "../../shared/exec.js"
import { repositoryRoot } from "../../shared/git.js"
import { WRITERS, defineVerb } from "../../shared/verb.js"
import { loadSlotRules, slotRoot, withSlot } from "../../harness/slots.js"
import { laneHolder, positiveInt, waitSeconds } from "../slot/holder.js"
import { runArgv } from "../slot/run.js"

/** How long a started web server has to answer on its port, by default. */
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

/** `K=V` pairs as an environment. */
const envPairs = (pairs: readonly string[]): Record<string, string> =>
    Object.fromEntries(
        pairs.map((pair) => {
            const at = pair.indexOf("=")
            if (at < 1) throw new Refusal("CLI_USAGE", `--serve-env takes NAME=value, not "${pair}"`)
            return [pair.slice(0, at), pair.slice(at + 1)]
        }),
    )

/**
 * `starci gallery shoot -- <capture command...>`: shoot the gallery at 1440 and 390 under a machine-wide shoot slot. It waits for
 * `--ready-url` (the api the screens read) and for the slot (which also waits for the kind's free RAM), starts `--serve` (a web dev
 * server on `--port`) when given and waits until it listens, runs the app's own capture command with `{port}` and `{url}` filled in,
 * then kills the server by the pid it started and releases the slot, however the shoot ends. The capture command is the app's: the
 * harness owns the slot, the server's life and the cleanup, never the screens or how they sign in.
 */
export const galleryShootVerb = defineVerb({
    path: ["gallery", "shoot"],
    summary: "shoot the gallery under a machine-wide shoot slot: wait for --ready-url and the slot, start --serve on --port and wait until it listens, run the app's capture command ({port}, {url} filled in), then kill the server by its pid and release the slot",
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/gallery-shoot@1",
    flags: {
        command: { kind: "rest", summary: "the app's capture command and its arguments, after -- ({port} and {url} are replaced)", required: true },
        serve: { kind: "string", summary: "the web server to start for the shoot, one shell command ({port} is replaced); none: the capture reaches a server already up" },
        port: { kind: "string", summary: "the port --serve listens on" },
        "serve-cwd": { kind: "string", summary: "where --serve runs (default: the repository root)" },
        "serve-env": { kind: "list", summary: "NAME=value for the server's environment, repeatable" },
        "ready-url": { kind: "string", summary: "a URL that must answer 200 before the slot is taken (the api the screens read)" },
        timeout: { kind: "string", summary: "seconds the server has to listen, and --ready-url to answer (default 180)" },
        lane: { kind: "string", summary: "the lane that holds the slot (default: STARCI_LANE, else the branch lane/<lane>)" },
        wait: { kind: "string", summary: "seconds to wait for a shoot slot before SLOT_BUSY (default: until one frees)" },
        dir: { kind: "string", summary: "the slot root (default: STARCI_LANES_DIR, else slots.root of ops/slots.yaml, else <harness state>/slots)" },
    },
    run: async (context, flags) => {
        const say = context.progress
        const root = await repositoryRoot(context.cwd)
        const lane = await laneHolder(root, flags.lane)
        const port = positiveInt("port", flags.port)
        if (flags.serve !== undefined && port === undefined) throw new Refusal("CLI_USAGE", "--serve needs --port: the shoot waits until the server listens there")
        const timeout = positiveInt("timeout", flags.timeout) ?? SERVE_TIMEOUT_S
        const fill = (text: string): string => (port === undefined ? text : text.replaceAll("{port}", String(port)).replaceAll("{url}", `http://localhost:${String(port)}`))
        const capture = flags.command.map(fill)
        if (flags["ready-url"] !== undefined) {
            say(`waiting for ${flags["ready-url"]}`)
            if (!(await waitFor(() => answers(flags["ready-url"] ?? ""), timeout))) throw new Refusal("GALLERY_SHOOT_NOT_READY", `${flags["ready-url"]} did not answer 200 within ${String(timeout)} s: the shoot needs it up and never starts it`)
        }
        const rules = loadSlotRules()
        const slots = slotRoot(flags.dir, rules)
        const env = envPairs(flags["serve-env"])
        const outcome = await withSlot(slots, rules, "shoot", lane, { waitSeconds: waitSeconds(flags.wait), say }, async (taken) => {
            say(`shoot slot ${String(taken.n)} held by ${lane}`)
            let server: number | undefined
            const log = join(slots, `_shoot-${lane}-server.log`)
            try {
                if (flags.serve !== undefined && port !== undefined) {
                    if (await listening(port)) throw new Refusal("GALLERY_SHOOT_PORT_BUSY", `port ${String(port)} already listens: pick a free --port; the shoot never reuses or kills a server it did not start`)
                    mkdirSync(slots, { recursive: true })
                    const out = openSync(log, "w")
                    const child = spawn(fill(flags.serve), { cwd: resolve(root, flags["serve-cwd"] ?? "."), env: { ...process.env, ...env }, shell: true, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", out, out] })
                    closeSync(out)
                    server = child.pid
                    child.unref()
                    say(`started ${fill(flags.serve)} (pid ${String(server)}, log ${log})`)
                    if (!(await waitFor(() => listening(port), timeout))) throw new Refusal("GALLERY_SHOOT_SERVE_TIMEOUT", `the server did not listen on ${String(port)} within ${String(timeout)} s: see ${log}`)
                }
                return { taken, run: await runArgv(capture, root, `gallery shoot ${lane}`, "build") }
            } finally {
                if (server !== undefined && pidAlive(server)) {
                    killPidTree(server)
                    say(`stopped the server (pid ${String(server)})`)
                }
            }
        })
        const { run, taken } = outcome
        for (const text of [run.stdout, run.stderr]) if (text !== "") say(text)
        return {
            data: { lane, slot: taken.n, reclaimed: taken.reclaimed, capture, exitCode: run.exitCode, stdout: run.stdout.slice(-4000), stderr: run.stderr.slice(-4000) },
            message: `${capture.join(" ")} exited ${String(run.exitCode)} under shoot slot ${String(taken.n)} (server stopped, slot released)`,
            exitCode: run.exitCode === 0 ? 0 : 1,
        }
    },
})
