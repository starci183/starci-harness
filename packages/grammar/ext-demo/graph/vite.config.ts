import { defineConfig } from "vite"

/** The demo page of @starci/grammar/core/ext/graph: every story of the graph, drawn from the package source (the JSX setting is the package tsconfig's). Not published. */
export default defineConfig({
    server: { host: "127.0.0.1", port: 5294, strictPort: true },
    // One React for the page, whichever folder a dependency was installed from.
    resolve: { dedupe: ["react", "react-dom"] },
})
