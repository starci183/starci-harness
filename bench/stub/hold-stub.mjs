// The bench's folder holder: a process that keeps its working folder from being removed, run by a scenario's
// `serve: {stub: hold, cwd: <folder>}` step, as a shell left open in a worktree does. On Windows its working directory alone
// holds the folder (rmdir answers EBUSY); elsewhere, where a working directory holds nothing, it makes the folder's parent
// read-only for as long as it runs (rmdir answers EACCES), and gives the parent its mode back when it ends. It prints
// `stub hold: <url> token <pid>`; `POST <url>/__exit` (or a SIGTERM) lets go of the folder and ends it. The Orca stand-in ends
// it that way when the terminal a scenario named it the process of is closed.
// It is preloaded with the Orca stand-in like every node of a bench run, which returns at once outside a binary named orca.
import { chmodSync, statSync } from "node:fs"
import { createServer } from "node:http"
import { dirname } from "node:path"

const parent = dirname(process.cwd())
const mode = process.platform === "win32" ? undefined : statSync(parent).mode & 0o777
if (mode !== undefined) chmodSync(parent, 0o555)

const release = () => {
    if (mode !== undefined) chmodSync(parent, mode)
}

process.on("SIGTERM", () => {
    release()
    process.exit(0)
})

const server = createServer((request, response) => {
    if (request.method === "POST" && request.url === "/__exit") {
        release()
        response.writeHead(200, { "Content-Type": "application/json" })
        response.end(JSON.stringify({ ok: true }), () => process.exit(0))
        return
    }
    response.writeHead(404)
    response.end()
})

server.listen(0, "127.0.0.1", () => {
    const { port } = server.address()
    process.stdout.write(`stub hold: http://127.0.0.1:${String(port)} token ${String(process.pid)}\n`)
})
