// The entrypoint of the uat container, never imported by the CLI: `starci uat run` copies the built file into the uat
// image. It opens each forwarded port on the container's own loopback (127.0.0.1, and ::1 where the kernel has it) and
// pipes every connection to the same port on the host, so the browser sees the app on 127.0.0.1 exactly as the host
// does: secure-context cookies, CSRF origins and OIDC redirect URIs hold. Then it imports the worker's script, with
// process.argv[1] set to the script, so the script reads its arguments (after `--` on starci uat run) as if run directly. Every
// listener and socket is unref'd, so the process ends when the script's own work ends, with the script's exit code.
// The relay reads the HTTP/1.x framing it pipes (never altering a byte) and tallies the pages the walk opened: each response to
// a request the browser made for a document (Sec-Fetch-Dest: document), redirects aside, and how many of them answered 5xx. At
// exit it prints the tally as one `starci-uat-pages {...}` line on stderr, which `starci uat run` keeps in the run's receipt.
import { writeSync } from "node:fs"
import { createConnection, createServer } from "node:net"
import type { Server, Socket } from "node:net"
import { pathToFileURL } from "node:url"

const fail = (message: string): never => {
    process.stderr.write(`starci uat: ${message}\n`)
    process.exit(1)
}

const upstream = process.env.STARCI_UAT_UPSTREAM ?? "host.docker.internal"
const script = process.env.STARCI_UAT_SCRIPT ?? fail("STARCI_UAT_SCRIPT is not set")
const ports = (process.env.STARCI_UAT_FORWARD ?? "")
    .split(",")
    .filter((entry) => entry !== "")
    .map((entry) => {
        const port = Number(entry)
        return Number.isInteger(port) && port > 0 && port < 65536 ? port : fail(`forward port "${entry}" is not a port`)
    })

const PAGES_MARKER = "starci-uat-pages"

/** The pages the walk opened and how many of them answered 5xx; printed at exit (PAGES_MARKER). */
const pages = { opened: 0, serverErrors: 0 }

process.on("exit", () => {
    writeSync(2, `${PAGES_MARKER} ${JSON.stringify(pages)}\n`)
})

/** A request the relay saw, waiting for its response: its method (a HEAD answer has no body) and whether it asked for a page. */
interface Asked {
    readonly method: string
    readonly page: boolean
}

/** How the body after a head is framed: a length, chunked, until the connection closes, or not HTTP the relay can follow. */
type Body = number | "chunked" | "close" | "off"

/** The head of one message: its start line and its headers, names lower-cased. */
interface Head {
    readonly start: string
    readonly headers: ReadonlyMap<string, string>
}

const HEAD_LIMIT = 65_536
const CRLF = Buffer.from("\r\n")
const HEAD_END = Buffer.from("\r\n\r\n")

const headOf = (raw: string): Head => {
    const [start = "", ...lines] = raw.split("\r\n")
    const headers = new Map<string, string>()
    for (const line of lines) {
        const colon = line.indexOf(":")
        if (colon > 0) headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim())
    }
    return { start, headers }
}

/** The body a message's headers frame: chunked, else its Content-Length, else `otherwise`. */
const framedBody = (head: Head, otherwise: Body): Body => {
    if (/\bchunked\b/i.test(head.headers.get("transfer-encoding") ?? "")) return "chunked"
    const length = head.headers.get("content-length")
    if (length === undefined) return otherwise
    return /^\d+$/.test(length) ? Number(length) : "off"
}

/**
 * A reader of one direction of an HTTP/1.x connection: it splits the bytes into heads and bodies (a length, chunks with their
 * trailers, or the rest of the connection) and hands each head to `onHead`, which says how its body is framed. Anything it
 * cannot follow (TLS, an upgraded connection, a head past HEAD_LIMIT) turns it off for the rest of the connection.
 */
const httpReader = (onHead: (head: Head) => Body): ((chunk: Buffer) => void) => {
    let buffered = Buffer.alloc(0)
    let state: "head" | "size" | "trailer" | "close" | "off" | { readonly left: number; readonly then: "head" | "size" } = "head"
    const step = (): boolean => {
        if (state === "off" || state === "close") {
            buffered = Buffer.alloc(0)
            return false
        }
        if (typeof state === "object") {
            const taken = Math.min(state.left, buffered.length)
            buffered = buffered.subarray(taken)
            state = state.left === taken ? state.then : { left: state.left - taken, then: state.then }
            return taken > 0 || state === "head" || state === "size"
        }
        if (state === "head") {
            // A TLS handshake opens with a 0x16 record: the relay pipes it, but nothing in it can be read.
            if (buffered[0] === 0x16) {
                state = "off"
                return true
            }
            const end = buffered.indexOf(HEAD_END)
            if (end < 0) {
                if (buffered.length > HEAD_LIMIT) state = "off"
                return state === "off"
            }
            const body = onHead(headOf(buffered.subarray(0, end).toString("latin1")))
            buffered = buffered.subarray(end + HEAD_END.length)
            state = body === "chunked" ? "size" : typeof body === "number" ? { left: body, then: "head" } : body
            return true
        }
        const end = buffered.indexOf(CRLF)
        if (end < 0) return false
        const line = buffered.subarray(0, end).toString("latin1")
        buffered = buffered.subarray(end + CRLF.length)
        if (state === "trailer") {
            if (line === "") state = "head"
            return true
        }
        const size = Number.parseInt(line.split(";")[0] ?? "", 16)
        state = Number.isNaN(size) ? "off" : size === 0 ? "trailer" : { left: size + CRLF.length, then: "size" }
        return true
    }
    return (chunk: Buffer): void => {
        buffered = Buffer.concat([buffered, chunk])
        while (buffered.length > 0 || state === "head" || state === "size") if (!step()) return
    }
}

/**
 * Taps one relayed connection: its requests queue what each asked for, and each final response (1xx informational aside) is
 * matched to the oldest request, counted in `pages` when that request asked for a page and the answer is not a redirect.
 */
const tap = (client: Socket, remote: Socket): void => {
    const asked: Asked[] = []
    const requests = httpReader((head) => {
        const method = /^([A-Z]+) \S+ HTTP\/1\.[01]$/.exec(head.start)?.[1]
        if (method === undefined) return "off"
        asked.push({ method, page: (head.headers.get("sec-fetch-dest") ?? "").toLowerCase() === "document" })
        return framedBody(head, 0)
    })
    const responses = httpReader((head) => {
        const status = Number(/^HTTP\/1\.[01] (\d{3})\b/.exec(head.start)?.[1] ?? Number.NaN)
        if (Number.isNaN(status) || status === 101) return "off"
        if (status < 200) return 0
        const request = asked.shift()
        if (request?.page === true && (status < 300 || status >= 400)) {
            pages.opened += 1
            if (status >= 500) pages.serverErrors += 1
        }
        if (request?.method === "HEAD" || status === 204 || status === 304) return 0
        return framedBody(head, "close")
    })
    // The tally never touches the bytes the relay pipes, and a reader that throws only stops tallying.
    const safely = (read: (chunk: Buffer) => void): ((chunk: Buffer) => void) => {
        let broken = false
        return (chunk) => {
            if (broken) return
            try {
                read(chunk)
            } catch {
                broken = true
            }
        }
    }
    client.on("data", safely(requests))
    remote.on("data", safely(responses))
}

// Half-open stays allowed on both legs so a request whose client closes its side first still gets the whole answer.
const relay = (client: Socket, port: number): void => {
    const remote = createConnection({ host: upstream, port, allowHalfOpen: true })
    client.unref()
    remote.unref()
    client.on("error", () => remote.destroy())
    remote.on("error", () => client.destroy())
    tap(client, remote)
    client.pipe(remote)
    remote.pipe(client)
}

const listen = (port: number, host: string): Promise<Server> =>
    new Promise((resolve, reject) => {
        const server = createServer({ allowHalfOpen: true }, (client) => {
            relay(client, port)
        })
        server.once("error", reject)
        server.listen(port, host, () => {
            server.unref()
            resolve(server)
        })
    })

const errorCode = (error: unknown): unknown => (typeof error === "object" && error !== null && "code" in error ? error.code : undefined)

const listenOn = async (port: number): Promise<void> => {
    await listen(port, "127.0.0.1").catch((error: unknown) => fail(`cannot listen on 127.0.0.1:${String(port)}: ${String(error)}`))
    // ::1 lets a browser that resolves localhost to IPv6 first reach the same forward; a container without IPv6 skips it.
    await listen(port, "::1").catch((error: unknown) => {
        const code = errorCode(error)
        if (code !== "EADDRNOTAVAIL" && code !== "EAFNOSUPPORT") fail(`cannot listen on [::1]:${String(port)}: ${String(error)}`)
    })
}

// One port after the other, as a failing bind ends the process with the first port that cannot be taken.
await ports.reduce<Promise<void>>((previous, port) => previous.then(() => listenOn(port)), Promise.resolve())

process.argv[1] = script
await import(pathToFileURL(script).href)
