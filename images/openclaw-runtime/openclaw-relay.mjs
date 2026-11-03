// A byte-for-byte TCP relay inside the OpenClaw task: it listens on the overlay address and forwards every connection to the loopback-only
// gateway (127.0.0.1:18789), so the gateway sees a loopback peer and honours the scopes a client declares. It adds no header and reads no frame.
import net from "node:net"

const listenPort = Number(process.env.OPENCLAW_RELAY_PORT || 18790)
const gatewayPort = 18789

const server = net.createServer((client) => {
    const gateway = net.connect({ host: "127.0.0.1", port: gatewayPort })
    const close = () => {
        client.destroy()
        gateway.destroy()
    }
    client.on("error", close)
    gateway.on("error", close)
    client.on("close", close)
    gateway.on("close", close)
    client.pipe(gateway)
    gateway.pipe(client)
})
server.on("error", (error) => {
    console.error("openclaw relay failed: " + error.message)
    process.exit(1)
})
server.listen(listenPort, "0.0.0.0", () => console.log("openclaw relay " + listenPort + " -> 127.0.0.1:" + gatewayPort))
