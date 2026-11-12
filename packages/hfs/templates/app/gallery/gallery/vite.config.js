import { defineConfig } from "vite"

// The shots are many and copied in bulk; watching them crashed the dev server with EBUSY on Windows.
// Only the sources and explain.md files are watched: reload the page after adding PNGs.
export default defineConfig({
    server: {
        watch: {
            ignored: ["**/*.png", "**/node_modules/**"],
            awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
        },
    },
})
