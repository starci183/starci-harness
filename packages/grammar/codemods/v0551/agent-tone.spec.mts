/**
 * v0551, the tone slot: the dev line's agent tones are deleted; `tone="agent"` and `agentToneOf(x)` of the Grammar become the app's `agentTone(x)`.
 *
 *   node --test codemods/v0551/agent-tone.spec.mts
 */
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import ts from "typescript"
import { IMPORT_NOTE, transformAgentTone } from "./agent-tone.mts"
import { runV0551 } from "./index.mts"

test("tone=\"agent\" on a Grammar Avatar becomes tone={agentTone(seed)}, else of its name, and the import is marked once", () => {
    const code = 'import { Avatar } from "@starci/grammar/common"\nexport const A = () => <><Avatar name={a.name} seed={a.key} tone="agent" /><Avatar name="Lan" tone="agent" /></>\n'
    const out = transformAgentTone(ts, "a.tsx", code)
    assert.equal(out.text, `${IMPORT_NOTE}\nimport { Avatar } from "@starci/grammar/common"\nexport const A = () => <><Avatar name={a.name} seed={a.key} tone={agentTone(a.key)} /><Avatar name="Lan" tone={agentTone("Lan")} /></>\n`)
    assert.equal(transformAgentTone(ts, "a.tsx", out.text).text, out.text, "a second run changes nothing")
})

test("agentToneOf(x) becomes agentTone(x) and the deleted exports leave the Grammar import", () => {
    const code = 'import { IconTile, agentToneOf, type AgentTone } from "@starci/grammar/common"\nconst t = <IconTile source={S} tone={agentToneOf(view.key)} />\n'
    const out = transformAgentTone(ts, "b.tsx", code)
    assert.equal(out.text, `${IMPORT_NOTE}\nimport { IconTile } from "@starci/grammar/common"\nconst t = <IconTile source={S} tone={agentTone(view.key)} />\n`)
    const only = 'import { agentToneOf } from "@starci/grammar/common"\nconst t = agentToneOf("x")\n'
    assert.equal(transformAgentTone(ts, "c.ts", only).text, `${IMPORT_NOTE}\nconst t = agentTone("x")\n`)
})

test("another library's tone=\"agent\", a local agentToneOf and a file without the Grammar are left; an untoned agent Avatar is listed only", () => {
    const other = 'import { Avatar } from "./mine"\nimport { agentToneOf } from "./palette"\nconst a = <Avatar tone="agent" seed={agentToneOf("k")} />\n'
    assert.equal(transformAgentTone(ts, "d.tsx", other).text, other)
    const untoned = 'import { Avatar } from "@starci/grammar/common"\nconst a = <Avatar name="Bot" kind="agent" />\n'
    const out = transformAgentTone(ts, "e.tsx", untoned)
    assert.equal(out.text, untoned)
    assert.equal(out.findings.length, 1)
    assert.match(out.findings[0]?.reason ?? "", /no longer wears an agent tone by itself/u)
})

test("runV0551 writes the rewrite in an app checkout", () => {
    const root = mkdtempSync(join(tmpdir(), "v0551-agent-"))
    try {
        const dir = join(root, "apps", "web", "src")
        mkdirSync(dir, { recursive: true })
        const file = join(dir, "agent.tsx")
        writeFileSync(file, 'import { Avatar } from "@starci/grammar/common"\nconst a = <Avatar name="x" seed={k} tone="agent" />\n')
        assert.equal(runV0551({ root, write: false, ts }).findings.length, 1)
        runV0551({ root, write: true, ts })
        assert.match(readFileSync(file, "utf8"), /tone=\{agentTone\(k\)\}/u)
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})
