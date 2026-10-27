import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

// `starci ui` serves the API on 127.0.0.1; the dev server proxies /api to it. STARCI_UI_URL may be the whole URL the
// command printed (token included): only its origin is the proxy target.
const apiOrigin = new URL(process.env.STARCI_UI_URL ?? "http://127.0.0.1:4317").origin

export default defineConfig({
    // Relative asset URLs: the bundle works from any folder and inside the Tauri shell.
    base: "./",
    plugins: [react(), tailwindcss()],
    // The API contract has one owner, `cli/src/core/ui/contract.ts`; the app imports its types only.
    resolve: { alias: { "@contract": fileURLToPath(new URL("../cli/src/core/ui/contract.ts", import.meta.url)) } },
    clearScreen: false,
    server: { port: 1420, strictPort: true, proxy: { "/api": apiOrigin } },
})
