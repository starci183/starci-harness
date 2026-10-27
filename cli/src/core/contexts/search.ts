import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { runtimeRoot } from "../../harness/ledger.js"
import { Refusal, UsageError } from "../../shared/errors.js"
import { EVERYONE, defineVerb } from "../../shared/verb.js"
import { SEARCH_SCOPES, readCorpus } from "./search-corpus.js"
import type { SearchScope } from "./search-corpus.js"
import { INDEX_PATH, loadIndex, search, staleness } from "./search-index.js"
import type { LoadedIndex, SearchHit } from "./search-index.js"

const DEFAULT_LIMIT = 5
const SNIPPET_CHARS = 280
// The eval scores a question by its first expected hit within this many ranks.
const EVAL_DEPTH = 10
const EVAL_RECALL_AT = 5

/** The search eval shipped beside this verb's source: real worker questions with the chunk ids that answer them. */
// A letter outside ASCII marks a question in another language (Vietnamese diacritics, other scripts); ids and names are ASCII.
const NON_ENGLISH_LETTER = /(?!\p{ASCII})\p{L}/u

const EVAL_FILE = join("cli", "src", "core", "contexts", "search-eval.json")

const evalSchema = z.object({
    schema: z.literal("starci/contexts-search-eval@1"),
    questions: z.array(z.object({ q: z.string(), expect: z.array(z.string()).min(1), scope: z.array(z.enum(SEARCH_SCOPES)).optional() })).min(1),
})

interface ModeScore {
    readonly mode: string
    readonly fallback: string | undefined
    readonly recallAt5: number
    readonly mrr: number
    readonly misses: readonly { readonly q: string; readonly expect: readonly string[]; readonly got: readonly string[] }[]
}

interface SearchData {
    readonly mode: "search" | "check" | "eval"
    readonly index: string
    readonly chunks: number
    readonly embedding: string
    readonly ranking?: "hybrid" | "lexical"
    readonly fallback?: string | undefined
    readonly hits?: readonly SearchHit[]
    readonly stale?: string | undefined
    readonly eval?: EvalResult
}

interface EvalResult {
    readonly questions: number
    readonly unknownIds: readonly string[]
    readonly scores: readonly ModeScore[]
}

const parseScopes = (value: string | undefined): SearchScope[] => {
    if (value === undefined || value === "") return []
    return value.split(",").map((item) => {
        const scope = SEARCH_SCOPES.find((known) => known === item.trim())
        if (scope === undefined) throw new UsageError(`--scope ${item} is no scope; use ${SEARCH_SCOPES.join(", ")}`)
        return scope
    })
}

const parseLimit = (value: string | undefined): number => {
    if (value === undefined) return DEFAULT_LIMIT
    const limit = Number(value)
    if (!Number.isInteger(limit) || limit < 1) throw new UsageError(`--limit ${value} is not a positive integer`)
    return limit
}

const indexOrRefuse = (): LoadedIndex => {
    const index = loadIndex()
    if (index === undefined) throw new Refusal("SEARCH_INDEX_MISSING", `no search index at ${INDEX_PATH}; run \`npm run build\` in cli/`)
    return index
}

const snippet = (text: string): string => {
    const flat = text.replace(/\s+/g, " ").trim()
    return flat.length <= SNIPPET_CHARS ? flat : `${flat.slice(0, SNIPPET_CHARS)} ...`
}

const describe = (index: LoadedIndex): Pick<SearchData, "index" | "chunks" | "embedding"> => ({
    index: INDEX_PATH,
    chunks: index.file.chunks.length,
    embedding: index.file.embedding === null ? `none: ${index.file.embeddingNote}` : index.file.embeddingNote,
})

const runEval = async (index: LoadedIndex, file: string): Promise<EvalResult> => {
    if (!existsSync(file)) throw new Refusal("SEARCH_EVAL_MISSING", `no eval file at ${file}`)
    const questions = evalSchema.parse(JSON.parse(readFileSync(file, "utf8"))).questions
    const known = new Set(index.file.chunks.map((chunk) => chunk.id))
    const unknownIds = [...new Set(questions.flatMap((item) => item.expect.filter((id) => !known.has(id))))]
    const modes = index.vectors === null ? [true] : [true, false]
    const scores: ModeScore[] = []
    for (const lexicalOnly of modes) {
        let found = 0
        let reciprocal = 0
        let fallback: string | undefined
        let mode = "lexical"
        const misses: { q: string; expect: readonly string[]; got: readonly string[] }[] = []
        for (const item of questions) {
            const ranking = await search(index, item.q, { scopes: item.scope ?? [], limit: EVAL_DEPTH, lexicalOnly })
            mode = ranking.mode
            fallback = lexicalOnly ? undefined : ranking.fallback
            const rank = ranking.hits.findIndex((hit) => item.expect.includes(hit.id))
            if (rank >= 0 && rank < EVAL_RECALL_AT) found += 1
            else misses.push({ q: item.q, expect: item.expect, got: ranking.hits.slice(0, 3).map((hit) => hit.id) })
            if (rank >= 0) reciprocal += 1 / (rank + 1)
        }
        scores.push({ mode, fallback, recallAt5: Number((found / questions.length).toFixed(3)), mrr: Number((reciprocal / questions.length).toFixed(3)), misses })
    }
    return { questions: questions.length, unknownIds, scores }
}

/**
 * `starci contexts search`: layer two of the context, knowledge looked up on demand. Ranks the chunks of contexts/, the op
 * files, policy/, the starci skill and the harness documents (each a Markdown section or a yaml entry) for a question, by BM25
 * fused with local embeddings when the index carries them, and prints each hit's id, file, line, score and text. The tree is
 * English, so a question in another language is refused with the hint to translate it first. A citable
 * id is a rule or record id the rules-cited trace accepts from that file. `--check` fails when the built index is stale;
 * `--eval` measures recall@5 and MRR on the eval set.
 */
export const contextsSearchVerb = defineVerb({
    path: ["contexts", "search"],
    summary: "look up contexts, op files, policy and harness docs for a question (BM25, fused with local embeddings when built); --check fails on a stale index, --eval measures recall",
    editions: ["lite", "full"],
    effect: "read",
    roles: EVERYONE,
    schema: "starci/contexts-search@1",
    flags: {
        question: { kind: "string", positional: true, summary: "the question, a rule id or a few words" },
        scope: { kind: "string", summary: `comma-separated scopes to search: ${SEARCH_SCOPES.join(", ")}` },
        limit: { kind: "string", summary: `how many hits to print (default ${String(DEFAULT_LIMIT)})` },
        lexical: { kind: "boolean", summary: "rank by BM25 only, even when the index carries vectors" },
        check: { kind: "boolean", summary: "exit 1 when the built index does not match the corpus" },
        eval: { kind: "boolean", summary: "measure recall@5 and MRR of each ranking on the search eval set" },
        file: { kind: "string", summary: "with --eval: an eval file other than the one beside the verb's source" },
    },
    run: async (_context, flags) => {
        const index = indexOrRefuse()
        if (flags.check) {
            const stale = staleness(index.file, readCorpus(runtimeRoot()))
            const data: SearchData = { mode: "check", ...describe(index), stale }
            const size = `${String(Math.round(statSync(INDEX_PATH).size / 1024))} KB`
            return {
                data,
                message: stale === undefined ? `green: ${INDEX_PATH} (${String(data.chunks)} chunks, ${size}) matches the corpus; vectors: ${data.embedding}` : `stale: ${stale}; run \`npm run build\` in cli/`,
                exitCode: stale === undefined ? 0 : 1,
            }
        }
        if (flags.eval) {
            const result = await runEval(index, flags.file ?? join(runtimeRoot(), EVAL_FILE))
            const data: SearchData = { mode: "eval", ...describe(index), eval: result }
            const lines = result.scores.map((score) => `${score.mode}: recall@5 ${String(score.recallAt5)}, MRR ${String(score.mrr)}, ${String(score.misses.length)} miss(es)${score.fallback === undefined ? "" : ` (fallback: ${score.fallback})`}`)
            const unknown = result.unknownIds.length === 0 ? "" : `\nexpected ids the index lacks: ${result.unknownIds.join(", ")}`
            return { data, message: `${String(result.questions)} question(s), vectors: ${data.embedding}\n${lines.join("\n")}${unknown}`, exitCode: unknown === "" ? 0 : 1 }
        }
        if (flags.question === undefined || flags.question.trim() === "") throw new UsageError("contexts search needs a question (or --check or --eval)")
        if (NON_ENGLISH_LETTER.test(flags.question)) {
            throw new Refusal("SEARCH_QUERY_NOT_ENGLISH", "the contexts are English: translate the question to English first and search again, keeping rule ids and names as written")
        }
        const ranking = await search(index, flags.question, { scopes: parseScopes(flags.scope), limit: parseLimit(flags.limit), lexicalOnly: flags.lexical })
        const data: SearchData = { mode: "search", ...describe(index), ranking: ranking.mode, fallback: ranking.fallback, hits: ranking.hits }
        const head = ranking.fallback === undefined ? `${ranking.mode} ranking` : `lexical ranking (BM25 only: ${ranking.fallback})`
        const body = ranking.hits.map((hit, at) => `${String(at + 1)}. ${hit.id}${hit.citable ? "" : " (not citable)"}  ${hit.path}:${String(hit.line)}  score ${String(hit.score)}\n   ${snippet(hit.text)}`)
        return { data, message: [head, ...(body.length === 0 ? ["no hit"] : body)].join("\n") }
    },
})
