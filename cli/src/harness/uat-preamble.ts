// The entrypoint of the uat container, never imported by the CLI: `starci uat run` copies the built file into the uat
// image. It opens each forwarded port on the container's own loopback (127.0.0.1, and ::1 where the kernel has it) and
// pipes every connection to the same port on the host, so the browser sees the app on 127.0.0.1 exactly as the host
// does: secure-context cookies, CSRF origins and OIDC redirect URIs hold. Then it imports the worker's script, with
// process.argv[1] set to the script, so the script reads its arguments (after `--` on starci uat run) as if run directly. Every
// listener and socket is unref'd, so the process ends when the script's own work ends, with the script's exit code.
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

// Half-open stays allowed on both legs so a request whose client closes its side first still gets the whole answer.
const relay = (client: Socket, port: number): void => {
    const remote = createConnection({ host: upstream, port, allowHalfOpen: true })
    client.unref()
    remote.unref()
    client.on("error", () => remote.destroy())
    remote.on("error", () => client.destroy())
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

for (const port of ports) {
    await listen(port, "127.0.0.1").catch((error: unknown) => fail(`cannot listen on 127.0.0.1:${String(port)}: ${String(error)}`))
    // ::1 lets a browser that resolves localhost to IPv6 first reach the same forward; a container without IPv6 skips it.
    await listen(port, "::1").catch((error: unknown) => {
        const code = errorCode(error)
        if (code !== "EADDRNOTAVAIL" && code !== "EAFNOSUPPORT") fail(`cannot listen on [::1]:${String(port)}: ${String(error)}`)
    })
}

process.argv[1] = script
await import(pathToFileURL(script).href)
