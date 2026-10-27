import { startDetached } from "../../shared/exec.js"
import { EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { startUi } from "./server.js"

/** The port `starci ui` binds when none is given. */
const DEFAULT_PORT = 4317

/** The host's own program that opens a URL in the default browser. */
const opener = (url: string): string[] => {
    if (process.platform === "win32") return ["explorer.exe", url]
    return process.platform === "darwin" ? ["open", url] : ["xdg-open", url]
}

/**
 * `starci ui [--port n] [--open]`: the local API the desktop app reads (cli/src/core/ui/contract.ts), on 127.0.0.1 with a bearer
 * token printed beside its URL. Reads come from the ledgers and the host store through the readers behind the read verbs; every
 * write runs its verb in-process as the owner. It serves until interrupted.
 */
export const uiVerb = defineVerb({
    path: ["ui"],
    summary: "serve the desktop app's local API on 127.0.0.1 (default port 4317) with a printed bearer token: overview, workflows, tasks, the owner's inbox, config and a live event stream; writes run their verbs as the owner",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["owner", "debug"],
    schema: "starci/ui@1",
    flags: {
        port: { kind: "string", summary: `the port to bind on 127.0.0.1 (default ${String(DEFAULT_PORT)}; 0 takes a free one)` },
        open: { kind: "boolean", summary: "open the server's address in the default browser once it listens" },
    },
    run: async (context, flags) => {
        const port = flags.port === undefined ? DEFAULT_PORT : Number(flags.port)
        if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Refusal("CLI_USAGE", `--port is a port from 0 to 65535, not "${String(flags.port)}"`, EXIT_USAGE)
        const server = await startUi(context, port)
        context.progress(`starci ui: ${server.url} token ${server.token} (Authorization: Bearer <token>); Ctrl+C stops it`)
        if (flags.open) await startDetached(opener(server.url), context.cwd)
        const stop = (): void => {
            server.close()
        }
        process.once("SIGINT", stop)
        process.once("SIGTERM", stop)
        await server.closed
        return { data: { url: server.url, port: server.port }, message: `starci ui on ${server.url} stopped` }
    },
})
