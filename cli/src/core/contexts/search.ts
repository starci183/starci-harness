import { existsSync, readFileSync, statSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"
import { z } from "zod"
import { runtimeRoot } from "../../harness/ledger.js"
import { inOrder } from "../../harness/sequential.js"
import { Refusal, UsageError } from "../../shared/errors.js"
import { EVERYONE, defineVerb } from "../../shared/verb.js"
import { EVAL_FILE } from "./anchors.js"
import { corpusRoot } from "./anchors-verb.js"
import { SEARCH_SCOPES, readCorpus } from "./search-corpus.js"
import type { SearchScope } from "./search-corpus.js"
import { INDEX_PATH, loadIndex, search, staleness } from "./search-index.js"
import type { LoadedIndex, SearchHit } from "./search-index.js"

const DEFAULT_LIMIT = 5
const SNIPPET_CHARS = 280
// The eval scores a question by its first expected hit within this many ranks.
const EVAL_DEPTH = 10
const EVAL_RECALL_AT = 5

// A letter outside ASCII marks a question in another language (Vietnamese diacritics, other scripts); ids and names are ASCII.
const NON_ENGLISH_LETTER = /(?!\p{ASCII})\p{L}/u

/**
 * The search eval shipped beside this verb's source: real worker questions with the anchors that answer them, and the
 * recall@5 floor each ranking must hold. A ranking that falls under its floor turns the eval red.
 */
const evalSchema = z.object({
    schema: z.literal("starci/contexts-search-eval@2"),
    threshold: z.strictObject({ lexical: z.number().min(0).max(1), hybrid: z.number().min(0).max(1) }),
    questions: z.array(z.object({ q: z.string(), expect: z.array(z.string()).min(1), scope: z.array(z.enum(SEARCH_SCOPES)).optional() })).min(1),
})

type EvalQuestion = z.infer<typeof evalSchema>["questions"][number]

interface ModeScore {
    readonly mode: "lexical" | "hybrid"
    readonly fallback: string | undefined
    readonly recallAt5: number
    readonly threshold: number
    readonly held: boolean
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

/** True when a hit answers a question: its anchor or one of its aliases is expected. */
const answers = (hit: SearchHit, expect: readonly string[]): boolean => expect.includes(hit.anchor) || hit.aliases.some((alias) => expect.includes(alias))

const runEval = async (index: LoadedIndex, file: string): Promise<EvalResult> => {
    if (!existsSync(file)) throw new Refusal("SEARCH_EVAL_MISSING", `no eval file at ${file}`)
    const parsed = evalSchema.parse(JSON.parse(readFileSync(file, "utf8")))
    const known = new Set(index.file.chunks.flatMap((chunk) => [chunk.anchor, ...chunk.aliases]))
    const unknownIds = [...new Set(parsed.questions.flatMap((item) => item.expect.filter((id) => !known.has(id))))]
    const modes = index.vectors === null ? [true] : [true, false]
    const scores = await inOrder(modes, (lexicalOnly) => scoreMode(index, parsed.questions, lexicalOnly, parsed.threshold))
    return { questions: parsed.questions.length, unknownIds, scores }
}

/** Recall@5, MRR and the misses of one ranking (BM25 only, or hybrid) over the eval questions, asked one after another. */
const scoreMode = async (index: LoadedIndex, questions: readonly EvalQuestion[], lexicalOnly: boolean, threshold: z.infer<typeof evalSchema>["threshold"]): Promise<ModeScore> => {
    let found = 0
    let reciprocal = 0
    const misses: ModeScore["misses"][number][] = []
    const rankings = await inOrder(questions, async (item) => {
        const ranking = await search(index, item.q, { scopes: item.scope ?? [], limit: EVAL_DEPTH, lexicalOnly })
        const rank = ranking.hits.findIndex((hit) => answers(hit, item.expect))
        if (rank >= 0 && rank < EVAL_RECALL_AT) found += 1
        else misses.push({ q: item.q, expect: item.expect, got: ranking.hits.slice(0, 3).map((hit) => hit.anchor) })
        if (rank >= 0) reciprocal += 1 / (rank + 1)
        return ranking
    })
    const mode = rankings.at(-1)?.mode ?? "lexical"
    const recallAt5 = Number((found / questions.length).toFixed(3))
    return {
        mode,
        fallback: lexicalOnly ? undefined : rankings.at(-1)?.fallback,
        recallAt5,
        threshold: threshold[mode],
        held: recallAt5 >= threshold[mode],
        mrr: Number((reciprocal / questions.length).toFixed(3)),
        misses,
    }
}

const evalFile = (cwd: string, flag: string | undefined): string => {
    if (flag === undefined) return join(runtimeRoot(), EVAL_FILE)
    return isAbsolute(flag) ? flag : resolve(cwd, flag)
}

/**
 * `starci contexts search`: layer two of the context, knowledge looked up on demand. Ranks the chunks of contexts/, the op
 * files, policy/, the starci skill and the harness documents (each a Markdown section or a yaml entry) for a question, by BM25
 * fused with local embeddings when the index carries them, and prints each hit's anchor first, then its file, line, score and
 * text: the anchor is what a worker cites, and `contexts anchor <anchor>` resolves it. The tree is English, so a question in
 * another language is refused with the hint to translate it first. `--check` fails when the built index does not match the
 * tree's files (it names the files that changed); `--eval` measures recall@5 and MRR and fails under the eval's floor.
 */
export const contextsSearchVerb = defineVerb({
    path: ["contexts", "search"],
    summary: "look up contexts, op files, policy and harness docs for a question, anchor first (BM25 fused with local embeddings); --check fails on a stale index, --eval fails under the recall floor",
    editions: ["lite", "full"],
    effect: "read",
    roles: EVERYONE,
    schema: "starci/contexts-search@2",
    flags: {
        question: { kind: "string", positional: true, summary: "the question, a rule id or a few words" },
        scope: { kind: "string", summary: `comma-separated scopes to search: ${SEARCH_SCOPES.join(", ")}` },
        limit: { kind: "string", summary: `how many hits to print (default ${String(DEFAULT_LIMIT)})` },
        lexical: { kind: "boolean", summary: "rank by BM25 only, even when the index carries vectors" },
        check: { kind: "boolean", summary: "exit 1 when the built index does not match the files of the tree" },
        root: { kind: "string", summary: "with --check: the tree to compare the built index with instead of the harness's own" },
        eval: { kind: "boolean", summary: "measure recall@5 and MRR of each ranking on the search eval set; exit 1 under its floor" },
        file: { kind: "string", summary: "with --eval: an eval file other than the one beside the verb's source" },
    },
    run: async (context, flags) => {
        const index = indexOrRefuse()
        if (flags.check) {
            const stale = staleness(index.file, readCorpus(corpusRoot(context.cwd, flags.root)))
            const data: SearchData = { mode: "check", ...describe(index), stale }
            const size = `${String(Math.round(statSync(INDEX_PATH).size / 1024))} KB`
            return {
                data,
                message: stale === undefined ? `green: ${INDEX_PATH} (${String(data.chunks)} chunks, ${size}) matches the tree; vectors: ${data.embedding}` : `SEARCH_INDEX_STALE: ${stale}; run \`npm run build\` in cli/`,
                exitCode: stale === undefined ? 0 : 1,
            }
        }
        if (flags.eval) {
            const result = await runEval(index, evalFile(context.cwd, flags.file))
            const data: SearchData = { mode: "eval", ...describe(index), eval: result }
            const lines = result.scores.map(
                (score) =>
                    `${score.held ? "held" : "SEARCH_RECALL_LOW"} ${score.mode}: recall@5 ${String(score.recallAt5)} (floor ${String(score.threshold)}), MRR ${String(score.mrr)}, ${String(score.misses.length)} miss(es)${score.fallback === undefined ? "" : " (fallback: " + score.fallback + ")"}`,
            )
            const unknown = result.unknownIds.length === 0 ? "" : `\nexpected ids the index lacks: ${result.unknownIds.join(", ")}`
            const red = unknown !== "" || result.scores.some((score) => !score.held)
            return { data, message: `${String(result.questions)} question(s), vectors: ${data.embedding}\n${lines.join("\n")}${unknown}`, exitCode: red ? 1 : 0 }
        }
        if (flags.question === undefined || flags.question.trim() === "") throw new UsageError("contexts search needs a question (or --check or --eval)")
        if (NON_ENGLISH_LETTER.test(flags.question)) {
            throw new Refusal("SEARCH_QUERY_NOT_ENGLISH", "the contexts are English: translate the question to English first and search again, keeping rule ids and names as written")
        }
        const ranking = await search(index, flags.question, { scopes: parseScopes(flags.scope), limit: parseLimit(flags.limit), lexicalOnly: flags.lexical })
        const data: SearchData = { mode: "search", ...describe(index), ranking: ranking.mode, fallback: ranking.fallback, hits: ranking.hits }
        const head = ranking.fallback === undefined ? `${ranking.mode} ranking; cite the anchor, \`starci contexts anchor <anchor>\` resolves it` : `lexical ranking (BM25 only: ${ranking.fallback})`
        const body = ranking.hits.map((hit, at) => `${String(at + 1)}. ${hit.anchor}${hit.citable ? "" : " (not a rules-cited id)"}  ${hit.path}:${String(hit.line)}  score ${String(hit.score)}\n   ${snippet(hit.text)}`)
        return { data, message: [head, ...(body.length === 0 ? ["no hit"] : body)].join("\n") }
    },
})
