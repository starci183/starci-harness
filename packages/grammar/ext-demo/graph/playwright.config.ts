import { defineConfig } from "@playwright/test"

/**
 * The browser proof of @starci/grammar/core/ext/graph: the stories of the demo page (`npm run ext:demo`, port 5294: its own, so a spec never reaches the old package demos on 5194) in Chromium at 1440 and 390 wide.
 * Pictures go to GRAPH_SHOTS_DIR (default e2e/shots); GRAPH_CHROMIUM names a Chromium to launch. Motion is on, so the specs can see which edge runs.
 */
export default defineConfig({
    testDir: "e2e",
    outputDir: "e2e/results",
    reporter: [["line"]],
    workers: 1,
    use: {
        baseURL: process.env.GRAPH_DEMO_URL ?? "http://127.0.0.1:5294",
        reducedMotion: "no-preference",
        // A Chromium already on the machine, when it is not the build this Playwright asks for.
        ...(process.env.GRAPH_CHROMIUM === undefined ? {} : { launchOptions: { executablePath: process.env.GRAPH_CHROMIUM } }),
    },
    projects: [
        // A test tagged @desktop runs only at 1440 (hover, editing, the wide layout), one tagged @phone only at 390 (a finger drag).
        { name: "1440", grepInvert: /@phone/, use: { viewport: { width: 1440, height: 900 } } },
        { name: "390", grepInvert: /@desktop/, use: { viewport: { width: 390, height: 844 } } },
    ],
})
