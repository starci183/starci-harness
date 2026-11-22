import assert from "node:assert/strict"
import fs from "node:fs"
import { describe, it } from "node:test"
import { compareSegments } from "../src/core/ext/markdown/compare.ts"
import { diagramKey } from "../src/core/ext/markdown/key.ts"
import { readLineList, readMeta } from "../src/core/ext/markdown/meta.ts"
import { parse, plainText } from "../src/core/ext/markdown/parse.ts"
import type { Block } from "../src/core/ext/markdown/types.ts"

const fixture = (name: string): string => fs.readFileSync(new URL(`./fixtures/ext-markdown/${name}`, import.meta.url), "utf8")

const only = (source: string): Block => {
    const [first] = parse(source).children
    assert.ok(first !== undefined, "one block")
    return first
}

const types = (blocks: readonly Block[]): string[] => blocks.map((block) => block.type)

describe("fence meta", () => {
    it("reads keys, quoted values and bare flags", () => {
        assert.deepEqual(readMeta('file=src/x.ts highlight=2,4-6 start=10 title="A · B" expected'), { values: { file: "src/x.ts", highlight: "2,4-6", start: "10", title: "A · B" }, flags: ["expected"] })
        assert.deepEqual(readMeta(null), { values: {}, flags: [] })
        assert.deepEqual(readLineList("2,4-6, 9 ,x,8-7"), [2, 4, 5, 6, 9])
        assert.deepEqual(readLineList(undefined), [])
    })
})

describe("parse: fences", () => {
    it("a ts fence keeps its file, start and highlighted lines", () => {
        const block = only("```ts file=src/x.ts highlight=11,12 start=10\nconst a = 1\nconst b = 2\nconst c = 3\n```")
        assert.ok(block.type === "code")
        assert.equal(block.lang, "ts")
        assert.equal(block.file, "src/x.ts")
        assert.equal(block.start, 10)
        assert.deepEqual(block.highlight, [11, 12])
        assert.deepEqual(block.at, { line: 1, column: 1, offset: 0, end: 84 })
    })

    it("a highlight outside the block is reported and dropped", () => {
        const tree = parse("```ts highlight=1,9\nconst a = 1\n```")
        assert.deepEqual(tree.issues.map((one) => one.code), ["MD_HIGHLIGHT_OUT_OF_RANGE"])
        const [block] = tree.children
        assert.ok(block?.type === "code" && block.highlight.length === 1)
    })

    it("a diff keeps each line's sign and its title", () => {
        const block = only('```diff title="A · before"\n-const a = 1\n+const a = 2\n same\nraw\n```')
        assert.ok(block.type === "diff")
        assert.equal(block.title, "A · before")
        assert.deepEqual(block.lines.map((line) => line.sign), ["-", "+", " ", " "])
        assert.equal(block.lines[3]?.text, "raw")
    })

    it("a terminal marks ✓ as a pass and ✕ as a fail, nothing else", () => {
        const block = only("```terminal\n  ✓ first check\n✕ second check\n$ npm test\n```")
        assert.ok(block.type === "terminal")
        assert.deepEqual(block.lines.map((line) => line.mark), ["pass", "fail", "none"])
    })

    it("a mermaid figure carries its caption and a stable key", () => {
        const block = only('```mermaid caption="Figure 1: flow"\nflowchart LR\n  A --> B\n```')
        assert.ok(block.type === "mermaid")
        assert.equal(block.caption, "Figure 1: flow")
        assert.equal(block.key, diagramKey("flowchart LR\n  A --> B"))
        assert.notEqual(diagramKey("a"), diagramKey("b"))
    })

    it("an unknown meta key is a warning, never an error", () => {
        const tree = parse("```ts colour=red\nx\n```")
        assert.deepEqual(tree.issues.map((one) => [one.code, one.severity]), [["MD_FENCE_META_UNKNOWN", "warning"]])
    })
})

describe("parse: directives", () => {
    it("callouts take their tone and their title from the label or the attribute", () => {
        const tree = parse(':::info[Heads up]\nRead this.\n:::\n\n:::warning{title="Careful"}\nX\n:::\n\n:::tip\nY\n:::')
        assert.deepEqual(
            tree.children.map((block) => (block.type === "callout" ? [block.tone, block.title] : [])),
            [["info", "Heads up"], ["warn", "Careful"], ["tip", undefined]],
        )
    })

    it("the owner's accordion of panels and its code/preview tabs", () => {
        const source = '::::::accordion\n:::::panel{title="Step 1"}\nA\n:::::\n\n:::::panel{title="Step 2"}\n::::tab\n:::code\n```tsx\n<A />\n```\n:::\n:::preview\n```mdx\n<A />\n```\n:::\n::::\n:::::\n::::::'
        const block = only(source)
        assert.ok(block.type === "accordion")
        assert.deepEqual(block.panels.map((panel) => panel.title), ["Step 1", "Step 2"])
        const [tabs] = block.panels[1]?.children ?? []
        assert.ok(tabs?.type === "tabs")
        assert.deepEqual(tabs.tabs.map((tab) => tab.kind), ["code", "preview"])
    })

    it("a lone panel is an accordion of one; a panel with no title is an error", () => {
        const tree = parse(":::panel\nX\n:::")
        assert.equal(tree.children[0]?.type, "accordion")
        assert.deepEqual(tree.issues.map((one) => one.code), ["MD_PANEL_TITLE_MISSING"])
    })

    it("compare reads its expected and received fences by flag, then by order", () => {
        const flagged = only(":::compare{expected=\"Wanted\"}\n```text received\n409\n```\n```text expected\n200\n```\n:::")
        assert.ok(flagged.type === "compare")
        assert.equal(flagged.expected, "200")
        assert.equal(flagged.received, "409")
        assert.equal(flagged.expectedLabel, "Wanted")
        const ordered = only(":::compare\n```\na\n```\n```\nb\n```\n:::")
        assert.ok(ordered.type === "compare" && ordered.expected === "a" && ordered.received === "b")
        assert.deepEqual(parse(":::compare\n```\na\n```\n:::").issues.map((one) => one.code), ["MD_COMPARE_INCOMPLETE"])
    })

    it("an unknown container is an error and its content is kept; a stray text directive stays words", () => {
        const tree = parse(":::banner\nhello\n:::\n\nAt 10:30 the job:run ran.")
        assert.deepEqual(types(tree.children), ["paragraph", "paragraph"])
        assert.equal(tree.issues[0]?.code, "MD_DIRECTIVE_UNKNOWN")
        const last = tree.children[1]
        assert.ok(last?.type === "paragraph")
        assert.equal(plainText(last.children), "At 10:30 the job:run ran.")
    })

    it("a leaf directive is an error drawn as written", () => {
        const tree = parse("::youtube[x]")
        assert.equal(tree.issues[0]?.code, "MD_DIRECTIVE_UNKNOWN")
        assert.ok(tree.children[0]?.type === "paragraph")
    })
})

describe("parse: no raw HTML, safe links, GFM", () => {
    it("drops raw HTML with an error and a comment quietly", () => {
        const tree = parse("<div>x</div>\n\n<!-- @starci/seperator -->\n\nA <b>bold</b> word")
        assert.deepEqual(tree.issues.map((one) => one.code), ["MD_RAW_HTML", "MD_RAW_HTML", "MD_RAW_HTML"])
        assert.deepEqual(types(tree.children), ["paragraph"])
    })

    it("refuses a script link and keeps its words", () => {
        const tree = parse("[go](javascript:alert(1)) and ![x](data:image/png;base64,AA) and [ok](https://starci.dev)")
        assert.deepEqual(tree.issues.map((one) => one.code), ["MD_LINK_UNSAFE", "MD_LINK_UNSAFE"])
        const [paragraph] = tree.children
        assert.ok(paragraph?.type === "paragraph")
        assert.deepEqual(paragraph.children.flatMap((one) => (one.type === "link" ? [one.url] : [])), ["https://starci.dev"])
    })

    it("reads tables, lists, quotes, rules, references and strikethrough", () => {
        const tree = parse("# T\n\n| a | b |\n|:-|-:|\n| 1 | 2 |\n\n3. x\n4. y\n\n> q\n\n---\n\n~~old~~ [ref][r] ![i][r]\n\n[r]: https://starci.dev\n\nText[^1]\n\n[^1]: note")
        assert.deepEqual(types(tree.children), ["heading", "table", "list", "blockquote", "thematicBreak", "paragraph", "paragraph", "paragraph"])
        const table = tree.children[1]
        assert.ok(table?.type === "table")
        assert.deepEqual(table.align, ["left", "right"])
        const list = tree.children[2]
        assert.ok(list?.type === "list" && list.ordered && list.start === 3)
    })

    it("inline code across lines is an error", () => {
        assert.deepEqual(parse("a `x\ny` b").issues.map((one) => one.code), ["MD_INLINE_CODE_MULTILINE"])
    })
})

describe("parse: a document in the legacy directive format", () => {
    it("reads the muted lines, the accordion of four steps with its code/preview tab, the figure and its caption line", () => {
        const tree = parse(fixture("legacy-format.md"), { legacyCaption: /^Figure \d+:/ })
        assert.deepEqual(tree.issues, [])
        const accordion = tree.children.find((block) => block.type === "accordion")
        assert.ok(accordion?.type === "accordion")
        assert.deepEqual(accordion.panels.map((panel) => panel.title.split(" - ")[0]), ["Step 1", "Step 2", "Step 3", "Step 4"])
        assert.ok(accordion.panels[2]?.children.some((block) => block.type === "tabs" && block.tabs.length === 2))
        assert.equal(tree.children.filter((block) => block.type === "callout" && block.tone === "muted").length, 3)
        const figure = tree.children.find((block) => block.type === "mermaid")
        assert.ok(figure?.type === "mermaid" && figure.caption.startsWith("Figure 1:"))
    })
})

describe("compare segments", () => {
    it("tints only the part that differs", () => {
        assert.deepEqual(compareSegments('{"status":200}', '{"status":409}'), {
            expected: [{ text: '{"status":', changed: false }, { text: "200", changed: true }, { text: "}", changed: false }],
            received: [{ text: '{"status":', changed: false }, { text: "409", changed: true }, { text: "}", changed: false }],
        })
        assert.deepEqual(compareSegments("same", "same"), { expected: [{ text: "same", changed: false }], received: [{ text: "same", changed: false }] })
    })
})

describe("parse: legacy figure captions", () => {
    it("a mermaid fence with no caption takes the legacy caption paragraph under it", () => {
        const legacyCaption = /^Figure \d+:/
        assert.deepEqual(types(parse("```mermaid\nA\n```\n\nFigure 1: x").children), ["mermaid", "paragraph"], "no option, no caption taken")
        const tree = parse("```mermaid\nflowchart LR\nA-->B\n```\n\nFigure 1: Client sends a `raw` body.\n\nNext.", { legacyCaption })
        assert.deepEqual(types(tree.children), ["mermaid", "paragraph"])
        const [figure] = tree.children
        assert.ok(figure?.type === "mermaid" && figure.caption === "Figure 1: Client sends a raw body.")
        const plain = parse("```mermaid\nA\n```\n\nNot a caption.", { legacyCaption })
        assert.deepEqual(types(plain.children), ["mermaid", "paragraph"])
    })
})
