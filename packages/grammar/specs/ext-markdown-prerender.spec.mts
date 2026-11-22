import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { parse } from "../src/core/ext/markdown/parse.ts"
import { mermaidBlocks, prefixIds, prerender, recolorMermaid, sanitizeSvg } from "../src/core/ext/markdown/prerender/index.ts"
import { highlight, highlightCode, prepare } from "../src/core/ext/markdown/server/index.ts"

const FLOW = '```mermaid caption="Figure 1: outbox"\nflowchart LR\n  Order[Ordre] --> Outbox --> Relay\n```'

describe("prerender: mermaid to SVG at import time", () => {
    it("beautiful-mermaid draws a flowchart on the Grammar tokens, safe to inline", async () => {
        const { diagrams, issues } = await prerender(FLOW)
        assert.deepEqual(issues, [])
        const [key] = Object.keys(diagrams)
        assert.ok(key !== undefined)
        const diagram = Object.values(diagrams)[0]
        assert.ok(diagram !== undefined)
        assert.equal(diagram.renderer, "beautiful-mermaid")
        const svg = diagram.svg
        assert.match(svg, /^<svg[^>]*role="img"/)
        assert.match(svg, /--bg:var\(--surface\);--fg:var\(--foreground\)/)
        assert.match(svg, /--bm-border:var\(--border\)/)
        assert.match(svg, /var\(--font-sans, system-ui, sans-serif\)/)
        assert.doesNotMatch(svg, /@import|fonts\.googleapis|<script/)
        assert.doesNotMatch(svg.slice(0, svg.indexOf(">")), /\swidth="|\sheight="/, "the root scales to its frame")
        assert.doesNotMatch(svg, /var\(--accent[,)]/, "the page accent never paints an arrow")
        assert.match(svg, new RegExp(`id="${key}-`), "ids carry the figure's key")
        assert.match(svg, /Ordre/)
    })

    it("one figure used twice is drawn once; nested figures are found", async () => {
        const tree = parse(`${FLOW}\n\n:::::panel{title="A"}\n${FLOW}\n:::::`)
        assert.equal(mermaidBlocks(tree.children).length, 2)
        const { diagrams } = await prerender(tree)
        assert.equal(Object.keys(diagrams).length, 1)
    })

    it("a diagram beautiful-mermaid cannot draw goes to the fallback, or is left to the browser", async () => {
        const source = '```mermaid caption="Figure 2: x"\nthis is not mermaid ((\n```'
        const drawn = await prerender(source, { fallback: (_code, key) => Promise.resolve(`<svg id="a" onload="x()"><use href="#a"/><script>1</script></svg>`.replace('id="a"', `id="${key}"`)) })
        const [only] = Object.values(drawn.diagrams)
        assert.equal(only?.renderer, "mermaid")
        assert.deepEqual(drawn.issues.map((one) => one.code), ["MD_MERMAID_FALLBACK"])
        const left = await prerender(source)
        assert.deepEqual(left.diagrams, {})
        assert.deepEqual(left.issues.map((one) => [one.code, one.line]), [["MD_MERMAID_FALLBACK", 1]])
        const failed = await prerender(source, { fallback: () => Promise.reject(new Error("bad")) })
        assert.deepEqual(failed.issues.map((one) => one.code), ["MD_MERMAID_INVALID"])
    })

    it("the sanitizer drops scripts, handlers, foreign objects and external references", () => {
        const dirty = '<svg onload="x()"><script>alert(1)</script><foreignObject><div>x</div></foreignObject><image href="https://evil.test/x.png"/><rect fill="url(https://evil.test/p)" style="fill:url(#ok)"/></svg>'
        const clean = sanitizeSvg(dirty)
        assert.doesNotMatch(clean, /onload|<script|foreignObject|evil\.test/)
        assert.match(clean, /url\(#ok\)/)
    })

    it("prefixIds rewrites ids and every reference to them", () => {
        const out = prefixIds('<svg><marker id="arrow"/><path marker-end="url(#arrow)"/><use href="#arrow"/><style>#arrow{fill:red}</style></svg>', "k1")
        assert.equal(out, '<svg><marker id="k1-arrow"/><path marker-end="url(#k1-arrow)"/><use href="#k1-arrow"/><style>#k1-arrow{fill:red}</style></svg>')
    })

    it("the Mermaid fallback's sentinel colours become Grammar tokens", () => {
        const out = recolorMermaid('<svg width="10" height="5" style="x"><rect fill="#FDFDFD" stroke="#dcdcdc"/><text style="font-family: trebuchet ms">a</text></svg>', "k")
        assert.match(out, /fill="var\(--surface\)" stroke="var\(--border\)"/)
        assert.doesNotMatch(out, /width="10"|trebuchet/)
    })
})

describe("server: Shiki highlighting at render time", () => {
    it("tokens carry the css-variables colours, one list per line", async () => {
        const tokens = await highlightCode("const a = 1\nreturn a", "ts")
        assert.ok(tokens !== undefined)
        assert.equal(tokens.length, 2)
        assert.ok(tokens[0]?.some((token) => token.content.includes("const") && token.color?.startsWith("var(--shiki-")))
        assert.equal(await highlightCode("x", "no-such-language"), undefined)
        assert.equal(await highlightCode("x", "text"), undefined)
        assert.ok((await highlightCode("echo 1", "sh"))?.length === 1)
    })

    it("highlights code and diff blocks wherever they sit", async () => {
        const tree = await highlight(parse('```ts\nconst a = 1\n```\n\n:::::panel{title="A"}\n```diff lang=ts\n-const a = 1\n+const a = 2\n```\n:::::\n\n```unknown\nplain\n```'))
        const [code, accordion, plain] = tree.children
        assert.ok(code?.type === "code" && code.tokens?.length === 1)
        assert.ok(accordion?.type === "accordion")
        const diff = accordion.panels[0]?.children[0]
        assert.ok(diff?.type === "diff" && diff.tokens?.length === 2)
        assert.ok(plain?.type === "code" && plain.tokens === undefined)
    })

    it("prepare parses, validates against the profile and highlights", async () => {
        const prepared = await prepare("```ts\na\n```\n\n```ts\nb\n```", "stem")
        assert.equal(prepared.profile, "stem")
        assert.deepEqual(prepared.issues.map((one) => one.code), ["MD_TOO_MANY"])
        assert.ok(prepared.tree.children[0]?.type === "code" && prepared.tree.children[0].tokens !== undefined)
        assert.equal((await prepare("x")).profile, "prose")
    })
})
