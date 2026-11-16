import { defineConfig } from "vite"

// The shots are many and copied in bulk; watching them crashed the dev server with EBUSY on Windows.
// Only the sources and explain.md files are watched: reload the page after adding PNGs.
// The server binds the IPv4 loopback: the dev tunnel routes to http://127.0.0.1:<port>, which an IPv6-only bind (::1) refuses with a 502. `allowedHosts` is
// the tunnel hosts the stack declares for the gallery (`local.tunnel.routes[]` named `gallery`); Vite answers 403 to any other Host.
export default defineConfig({
    server: {
        host: "127.0.0.1",
        allowedHosts: {{galleryAllowedHosts}},
        watch: {
            ignored: ["**/*.png", "**/node_modules/**"],
            awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
        },
    },
})
