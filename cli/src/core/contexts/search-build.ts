import { statSync } from "node:fs"
import { runtimeRoot } from "../../harness/ledger.js"
import { INDEX_PATH, buildIndex, writeIndex } from "./search-index.js"

/**
 * The build step of `npm run build` and `prepack`: chunks the corpus under the runtime root, embeds it with the pinned local
 * model when it loads (downloading it once into the model cache), and writes cli/dist/contexts-search.json.
 */
const index = await buildIndex(runtimeRoot(), (line) => process.stdout.write(`contexts search: ${line}\n`))
writeIndex(index)
const kb = Math.round(statSync(INDEX_PATH).size / 1024)
const vectors = index.embedding === null ? "none (" + index.embeddingNote + ")" : index.embeddingNote
process.stdout.write(`contexts search: ${String(index.chunks.length)} chunks from ${String(index.files)} files, ${String(kb)} KB at ${INDEX_PATH}; vectors: ${vectors}\n`)
