import { parentPort, workerData } from "node:worker_threads"
import { placeChunk } from "./place-chunk.js"
import type { PlacedFile } from "./place-chunk.js"

/** The worker thread of the shared install (harness/shared-install.ts): places one chunk of files with synchronous calls and reports how many it copied. */
const given = workerData as { readonly files: readonly PlacedFile[]; readonly linking: boolean }
try {
    parentPort?.postMessage({ copied: placeChunk(given.files, given.linking) })
} catch (error) {
    parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) })
}
