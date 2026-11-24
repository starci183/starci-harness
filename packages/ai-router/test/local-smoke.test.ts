import assert from "node:assert/strict"
import { before, describe, test } from "node:test"
import { holdsModel, localModel, LOCAL_MODELS, probeLocal } from "../src/local.ts"
import type { LocalProbe } from "../src/local.ts"
import { createRouter } from "../src/router.ts"

/**
 * An opt-in check against a real Ollama on this machine, run on request only (contexts/project/cicd.md R12: no default row of
 * the release gate touches the host's servers): `LOCAL_AI_SMOKE=1 node --test test/local-smoke.test.ts`. It then runs only when
 * a server answers on the base URL (default `http://localhost:11434/v1`, or LOCAL_AI_BASE_URL), and each part only when the
 * model it needs is already pulled: it never pulls a model and never fails for a machine that has none.
 */
const REQUESTED = process.env.LOCAL_AI_SMOKE === "1"
const BASE_URL = process.env.LOCAL_AI_BASE_URL ?? "http://localhost:11434/v1"
const EMBEDDING = "qwen3-embedding:8b"

function unitNorm(vector: readonly number[]): number {
    return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
}

describe("a real local server", { skip: REQUESTED ? false : "run on request: LOCAL_AI_SMOKE=1" }, () => {
    let probe: LocalProbe | undefined
    before(async () => {
        probe = await probeLocal({ baseUrl: BASE_URL, timeoutMs: 1500 }).catch(() => undefined)
    })

    test("lists its models", (t) => {
        if (probe === undefined) { t.skip(`no server answers at ${BASE_URL}`); return; }
        assert.ok(probe.models.length >= 0)
        assert.ok(["/v1/models", "/api/tags"].includes(probe.source))
        t.diagnostic(`${probe.source} lists: ${probe.models.map((model) => model.id).join(", ") || "(no models)"}`)
    })

    test("embeds with qwen3-embedding:8b: 4096 native, 1024 cut and at unit length", async (t) => {
        if (probe === undefined) { t.skip(`no server answers at ${BASE_URL}`); return; }
        if (!holdsModel(probe, EMBEDDING)) { t.skip(`${EMBEDDING} is not pulled`); return; }
        const router = createRouter({ providers: [{ id: "gpu", kind: "local", baseUrl: BASE_URL, keys: [], models: [localModel(EMBEDDING, { dimensions: 1024 })] }] })
        const cut = await router.embeddings({ model: EMBEDDING, input: "a short sentence to embed" }, { policy: { timeoutMs: 120_000 } })
        const vector = cut.data[0]?.embedding
        assert.ok(Array.isArray(vector))
        assert.equal(vector.length, 1024)
        assert.ok(Math.abs(unitNorm(vector) - 1) < 1e-6, "unit length")
        assert.equal(cut.routing.cost, 0)
        const native = await router.embeddings({ model: EMBEDDING, input: "a short sentence to embed", dimensions: 4096 })
        const full = native.data[0]?.embedding
        assert.ok(Array.isArray(full))
        assert.equal(full.length, LOCAL_MODELS.find((model) => model.id === EMBEDDING)?.dimensions)
        // The 1024 vector is the native one's prefix at unit length. Two runs of a GPU model differ slightly (more right after a
        // load or under another load), so the whole prefix is compared by its cosine, not one element's ratio.
        const cutVector: readonly number[] = vector
        const prefix: readonly number[] = full.slice(0, 1024)
        const cosine = cutVector.reduce((sum, value, index) => sum + value * (prefix[index] ?? 0), 0) / unitNorm(prefix)
        assert.ok(cosine > 0.999, `cosine of the cut and the native prefix: ${cosine.toFixed(6)}`)
    })

    test("chats with a small model when one is already pulled", async (t) => {
        if (probe === undefined) { t.skip(`no server answers at ${BASE_URL}`); return; }
        const found = probe
        const chatModel = LOCAL_MODELS.filter((model) => model.kind === "chat")
            .map((model) => model.id)
            .find((id) => holdsModel(found, id))
        if (chatModel === undefined) { t.skip("no chat model is pulled"); return; }
        const router = createRouter({ providers: [{ id: "gpu", kind: "local", baseUrl: BASE_URL, keys: [], models: [localModel(chatModel)] }] })
        const answer = await router.chat({ model: chatModel, max_tokens: 8, messages: [{ role: "user", content: "Say ok." }] })
        assert.ok((answer.choices[0]?.message.content ?? "").length > 0)
        assert.equal(answer.routing.cost, 0)
    })
})
