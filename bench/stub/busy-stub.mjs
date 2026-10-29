// The bench's CPU burner: another program keeping this host's CPU busy (another app's gate, a virus scan), run by a scenario's
// `serve: {stub: busy}` step so the CPU average the heavy governor reads is above a tiny ceiling on any host, an idle one
// included. It spins one core in short slices, so a signal or a request still reaches it between them, and prints
// `stub busy: <url> token <pid>`; `POST <url>/__exit`, a SIGTERM or the end of the scenario stops it.
// It is preloaded with the Orca stand-in like every node of a bench run, which returns at once outside a binary named orca.
import { createServer } from "node:http"

const SLICE_MS = 50

const spin = () => {
    const until = Date.now() + SLICE_MS
    while (Date.now() < until) {
        // Busy on purpose: this process stands in for a program that keeps a core at work.
    }
    setImmediate(spin)
}

const server = createServer((request, response) => {
    if (request.method === "POST" && request.url === "/__exit") {
        response.writeHead(200, { "Content-Type": "application/json" })
        response.end(JSON.stringify({ ok: true }), () => process.exit(0))
        return
    }
    response.writeHead(404)
    response.end()
})

server.listen(0, "127.0.0.1", () => {
    const { port } = server.address()
    process.stdout.write(`stub busy: http://127.0.0.1:${String(port)} token ${String(process.pid)}\n`)
    spin()
})
