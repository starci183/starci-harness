import { createReadStream, existsSync, statSync } from "node:fs"
import { createServer } from "node:http"
import type { Server } from "node:http"
import type { AddressInfo } from "node:net"
import { extname, join, resolve, sep } from "node:path"

const TYPES: Readonly<Record<string, string>> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".map": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
}

/** A folder served read-only on a loopback port for as long as the check runs. */
export interface StaticSite {
    readonly url: string
    readonly close: () => Promise<void>
}

/** Serves a built folder (a Storybook build, a static export, a fixture) on 127.0.0.1; a path outside the folder is 404. */
export const serveFolder = async (folder: string): Promise<StaticSite> => {
    const base = resolve(folder)
    const server: Server = createServer((request, response) => {
        const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname)
        let file = resolve(join(base, pathname))
        if (file !== base && !file.startsWith(base + sep)) {
            response.writeHead(404).end()
            return
        }
        if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html")
        if (!existsSync(file) || !statSync(file).isFile()) {
            response.writeHead(404).end()
            return
        }
        response.writeHead(200, { "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store" })
        createReadStream(file).pipe(response)
    })
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => {
        done()
    }))
    const { port } = server.address() as AddressInfo
    return {
        url: `http://127.0.0.1:${String(port)}`,
        close: () =>
            new Promise<void>((done) => {
                server.closeAllConnections()
                server.close(() => {
                    done()
                })
            }),
    }
}
