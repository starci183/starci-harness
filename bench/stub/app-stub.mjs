// The bench's app stand-in: the app a walk opens, served on 127.0.0.2 (where the Docker stand-in's relay reaches it), answering
// every page with the status `--status` names (default 500, an app that cannot load a module) and `/asset.js` with 200, as a dev
// server's error page still serves its own scripts. It prints `stub app: <url> token <port>`; `POST <url>/__exit`, a SIGTERM or
// the scenario's end stops it. It is preloaded with the other stand-ins like every node of a bench run, which return at once here.
import { createServer } from "node:http"

const flag = process.argv.indexOf("--status")
const status = flag < 0 ? 500 : Number(process.argv[flag + 1])

const server = createServer((request, response) => {
    if (request.method === "POST" && request.url === "/__exit") {
        response.writeHead(200, { "Content-Type": "application/json" })
        response.end(JSON.stringify({ ok: true }), () => process.exit(0))
        return
    }
    if (request.url === "/asset.js") {
        response.writeHead(200, { "Content-Type": "text/javascript" })
        response.end("export {}\n")
        return
    }
    const body = status >= 500 ? "Module not found: Can't resolve '@bench/ui'" : "<!doctype html><title>page</title><main>page</main>"
    response.writeHead(status, { "Content-Type": "text/html" })
    response.end(body)
})

server.listen(0, "127.0.0.2", () => {
    const { port } = server.address()
    process.stdout.write(`stub app: http://127.0.0.2:${String(port)} token ${String(port)}\n`)
})
