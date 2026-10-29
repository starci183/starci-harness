// The bench's folder holder: a process that keeps a folder from being removed, run by a scenario's `serve: {stub: hold, cwd:
// <folder>}` step. By default it holds its working folder, as a shell left open in a worktree does: on Windows its working
// directory alone holds the folder (rmdir answers EBUSY). With `args: [--hold, <file>]` it holds the folder of that file from
// outside, its working directory elsewhere, as a program the harness never started and that never worked in the folder does: on
// Windows it opens the file with an exclusive lock (no share mode, so neither the file nor its folder can be deleted).
// Elsewhere, where a working directory or an open file holds nothing, it makes the held folder itself (its working folder, or
// the folder of the held file) read-only for as long as it runs, so nothing in it can be deleted and neither it nor a folder
// above it can be removed (EACCES), while its parent and siblings stay writable; it gives the folder its mode back when it ends.
// A removal that runs while it holds therefore leaves the folder with its files on POSIX where Windows may have emptied it; the
// harness removes either once the holder is gone (harness/land.ts removeWorktreeFolder). It prints
// `stub hold: <url> token <pid>`; `POST <url>/__exit` (or a SIGTERM) lets go of the folder and ends it. The Orca stand-in ends
// it that way when the terminal a scenario named it the process of is closed.
// It is preloaded with the Orca stand-in like every node of a bench run, which returns at once outside a binary named orca.
import { spawn } from "node:child_process"
import { chmodSync, closeSync, openSync, constants, statSync } from "node:fs"
import { createServer } from "node:http"
import { dirname, resolve } from "node:path"

// With `--child <folder>` it also starts a child node process that idles with that folder as its working directory, as a
// shell's command outlives the line that started it; the child is ended with the stub.
const childAt = process.argv.indexOf("--child")
const child = childAt >= 0 && process.argv[childAt + 1] !== undefined ? spawn(process.execPath, ["-e", "setInterval(() => {}, 1e9)"], { cwd: resolve(process.argv[childAt + 1]), stdio: "ignore", windowsHide: true }) : undefined
process.on("exit", () => child?.kill())

// libuv's UV_FS_O_EXLOCK on Windows: open with no share mode.
const EXCLUSIVE = 0x10000000

const at = process.argv.indexOf("--hold")
const file = at >= 0 && process.argv[at + 1] !== undefined ? resolve(process.argv[at + 1]) : undefined
const folder = file === undefined ? process.cwd() : dirname(file)
const locked = process.platform === "win32" && file !== undefined ? openSync(file, constants.O_RDONLY | EXCLUSIVE) : undefined
const mode = process.platform === "win32" ? undefined : statSync(folder).mode & 0o777
if (mode !== undefined) chmodSync(folder, 0o555)

const release = () => {
    if (mode !== undefined) chmodSync(folder, mode)
    if (locked !== undefined) closeSync(locked)
}

process.on("SIGTERM", () => {
    release()
    process.exit(0)
})

const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/__child") {
        response.writeHead(200, { "Content-Type": "application/json" })
        response.end(JSON.stringify({ pid: child?.pid ?? null }))
        return
    }
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
