import assert from "node:assert/strict"
import fs from "node:fs"
import { after, before, describe, it } from "node:test"
import { JSDOM } from "jsdom"
import { act, createElement as h, createRef } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { parse } from "../src/core/ext/markdown/parse.ts"
import { prerender } from "../src/core/ext/markdown/prerender/index.ts"
import { Markdown, type MarkdownHandle, type MarkdownProps } from "../src/core/ext/markdown/react/index.ts"
import { prepare } from "../src/core/ext/markdown/server/index.ts"

const html = (props: MarkdownProps): string => renderToStaticMarkup(h(Markdown, props))
const fixture = (name: string): string => fs.readFileSync(new URL(`./fixtures/ext-markdown/${name}`, import.meta.url), "utf8")
const offsetOf = (source: string, words: string): { start: number; end: number } => {
    const start = source.indexOf(words)
    assert.ok(start >= 0, words)
    return { start, end: start + words.length }
}

describe("render: built on Grammar core", () => {
    it("headings are Grammar Headings and paragraphs Text in the body role", () => {
        const out = html({ source: "## Section\n\nA plain sentence." })
        assert.match(out, /<h2[^>]*data-component="Heading"[^>]*>Section<\/h2>/)
        assert.match(out, /<p[^>]*data-component="Text"[^>]*data-role="body"[^>]*>A plain sentence\.<\/p>/)
    })

    it("inline code is Grammar's Code", () => {
        assert.match(html({ source: "Call `retry()` twice." }), /<code[^>]*class="starci-core-code[^"]*"[^>]*>retry\(\)<\/code>/)
    })

    it("a code block is Grammar's FencedCodeBlock: its header, a language Badge and Copy, line numbers from start, highlighted lines", () => {
        const out = html({ source: "```ts file=src/x.ts highlight=11 start=10\nconst a = 1\nconst b = 2\n```" })
        assert.match(out, /data-component="FencedCodeBlock"/)
        assert.match(out, /<span>src\/x\.ts<\/span>/)
        assert.match(out, /data-component="Badge"[\s\S]*>ts</)
        assert.match(out, />Copy</)
        assert.match(out, /<code class="starci-type-code">/)
        assert.match(out, /<span class="starci-md-gutter" aria-hidden="true">10<\/span>/)
        assert.match(out, /<span class="starci-md-line" data-highlighted="true"><span class="starci-md-gutter" aria-hidden="true">11<\/span>/)
    })

    it("Shiki tokens are drawn with their css-variable colours", async () => {
        const prepared = await prepare("```ts\nconst a = 1\n```")
        assert.match(html({ tree: prepared.tree }), /style="color:var\(--shiki-token-keyword\)">const</)
    })

    it("a diff: a −/+ gutter and rows marked add or remove", () => {
        const out = html({ source: '```diff title="A · ttl"\n-ttl: 60\n+ttl: 300\n same\n```' })
        assert.match(out, /data-kind="diff"/)
        assert.match(out, /data-sign="remove"><span class="starci-md-gutter" aria-hidden="true">−<\/span>/)
        assert.match(out, /data-sign="add"><span class="starci-md-gutter" aria-hidden="true">\+<\/span>/)
    })

    it("a terminal is Grammar's Terminal", () => {
        const out = html({ source: '```terminal title="Run"\n✓ first check\n✕ second check\n```' })
        assert.match(out, /data-component="Terminal"/)
        assert.match(out, /✓ first check[\s\S]*✕ second check/)
    })

    it("a compare: two columns of FencedCodeBlocks, the differing part tinted, the labels from the consumer", () => {
        const out = html({ source: ':::compare{received="Got"}\n```json expected\n{"status":200}\n```\n```json received\n{"status":409}\n```\n:::', labels: { expected: "Wanted" } })
        assert.match(out, /data-side="expected"[\s\S]*Wanted[\s\S]*<mark class="starci-md-compare-change">200<\/mark>/)
        assert.match(out, /data-side="received"[\s\S]*Got[\s\S]*<mark class="starci-md-compare-change">409<\/mark>/)
    })

    it("callouts are Grammar Alerts of their tone; muted is a Text label line", () => {
        const out = html({ source: ":::warn[Heads up]\nDo not retry blindly.\n:::\n\n:::tip\nUse a key.\n\nAnother paragraph.\n:::\n\n:::danger\nX\n:::\n\n:::info\nY\n:::\n\n:::muted\nGoal\n:::", labels: { tip: "Hint" } })
        assert.match(out, /data-component="Alert" data-grammar-tone="cautionary"/)
        assert.match(out, /Heads up/)
        assert.match(out, /data-grammar-tone="affirmative"[\s\S]*Hint[\s\S]*Another paragraph/)
        assert.match(out, /data-grammar-tone="negative"/)
        assert.match(out, /data-grammar-tone="informative"/)
        assert.match(out, /data-role="label.group"[^>]*>Goal<\/p>/)
    })

    it("an accordion is Grammar Disclosures, a rule is a Divider, a table scrolls in MarkdownTableFrame", () => {
        const out = html({ source: '::::::accordion\n:::::panel{title="Step 1"}\nA\n:::::\n:::::panel{title="Step 2"}\nB\n:::::\n::::::\n\n---\n\n| a | b |\n|:-|-:|\n| 1 | 2 |', labels: { table: "Values" } })
        assert.equal((out.match(/data-component="Disclosure"/g) ?? []).length, 2)
        assert.match(out, /data-component="Divider"/)
        assert.match(out, /data-component="MarkdownTableFrame"[^>]*tabindex="0" role="region" aria-label="Values"/)
        assert.match(out, /<th scope="col" style="text-align:left">a<\/th>/)
    })

    it("a prerendered mermaid figure is the one Fragment, with its caption; a missing one waits on a skeleton", async () => {
        const source = '```mermaid caption="Figure 1: flow"\nflowchart LR\nA-->B\n```'
        const { diagrams } = await prerender(source)
        const drawn = html({ source, diagrams })
        assert.match(drawn, /<figure class="starci-md-figure"[^>]*><div class="starci-md-figure-art" role="img" aria-label="Figure 1: flow"><svg/)
        assert.match(drawn, /<figcaption><span[^>]*data-role="caption"[^>]*>Figure 1: flow<\/span><\/figcaption>/)
        const waiting = html({ source })
        assert.match(waiting, /aria-busy="true"/)
        assert.doesNotMatch(waiting, /<svg xmlns/)
    })

    it("lists, quotes, links and images draw as semantic elements with Grammar parts", () => {
        const out = html({ source: "1. a\n2. **b**\n\n- x\n\n  y\n\n> q\n\n[Docs](https://example.com) ~~old~~ *slanted*  \n![logo](/logo.png)" })
        for (const tag of ["<ol>", "<ul>", "<blockquote>", "<del>", "<em>", "<br/>"]) assert.ok(out.includes(tag), tag)
        assert.match(out, /href="https:\/\/example\.com"/)
        assert.match(out, /logo\.png/)
    })
})

describe("render: highlights", () => {
    const source = "First sentence with `code` inside.\nSecond line of it.\n\nAnother paragraph here."

    it("marks a range in a Grammar soft tone, split exactly at its edges", () => {
        const out = html({ source, highlights: [{ id: "h1", ...offsetOf(source, "sentence with"), tone: "info" }] })
        assert.match(out, /First <mark class="starci-md-highlight" data-highlight-id="h1" data-tone="info">sentence with<\/mark> /)
    })

    it("survives inline code and a line break: the code is marked whole, the next line in its own mark", () => {
        const out = html({ source, highlights: [{ id: "h2", ...offsetOf(source, "with `code` inside.\nSecond") }] })
        assert.match(out, /<mark[^>]*data-highlight-id="h2" data-tone="warning"><code[^>]*>code<\/code><\/mark>/)
        assert.equal((out.match(/data-highlight-id="h2"/g) ?? []).length, 3)
        assert.match(out, /<mark[^>]*data-highlight-id="h2"[^>]*> inside\.\nSecond<\/mark>/)
    })

    it("a range over two blocks is marked in each; its note stands under the block where it ends", () => {
        const out = html({ source, highlights: [{ id: "h3", ...offsetOf(source, "of it.\n\nAnother"), note: "Read both together.", tone: "success" }] })
        assert.equal((out.match(/data-highlight-id="h3"/g) ?? []).length, 2)
        assert.match(out, /Another<\/mark> paragraph here\.<\/p><div class="starci-md-highlight-note" data-highlight-note="h3" data-tone="success"><p[^>]*data-role="caption"[^>]*>Read both together\.<\/p><\/div>/)
        assert.equal((out.match(/data-highlight-note=/g) ?? []).length, 1)
    })

    it("an empty or outside range draws nothing; without highlights the text is unchanged", () => {
        assert.equal(html({ source, highlights: [{ id: "x", start: 5, end: 5 }, { id: "y", start: 900, end: 950 }] }), html({ source }))
    })
})

describe("render: profiles and loading", () => {
    it("draws only what the profile allows, and at most its maximum", () => {
        const source = "# Title\n\nCall `f` and [link](https://example.com)?\n\n```ts\na\n```\n\n```ts\nb\n```\n\n```diff\n-a\n+b\n```"
        const stem = html({ source, profile: "stem" })
        assert.doesNotMatch(stem, /data-component="Heading"|data-kind="diff"|href=/)
        assert.equal((stem.match(/data-kind="code"/g) ?? []).length, 1)
        assert.match(stem, /link\?/)
        const option = html({ source, profile: "option" })
        assert.match(option, /data-kind="diff"/)
        assert.doesNotMatch(option, /data-kind="code"/)
    })

    it("a stem image draws as its alt words", () => {
        assert.match(html({ source: "See ![the chart](/x.png)", profile: "stem" }), /See the chart/)
    })

    it("loading is skeleton lines and no words", () => {
        const out = html({ source: "Real words", isLoading: true })
        assert.match(out, /aria-busy="true"/)
        assert.doesNotMatch(out, /Real words/)
    })

    it("draws a document in the directive format whole", async () => {
        const body = fixture("directive-format.md")
        const { diagrams } = await prerender(parse(body))
        const out = html({ source: body, diagrams })
        assert.match(out, /Figure 1:/)
        assert.match(out, /Step 4/)
        assert.match(out, /data-component="Tabs"|role="tablist"/)
        assert.doesNotMatch(out, /section separator/)
    })
})

describe("render: in a browser", () => {
    const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true })
    const borrowed = ["window", "document", "navigator", "HTMLElement", "Element", "Node", "IS_REACT_ACT_ENVIRONMENT", "ResizeObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "CSS", "MutationObserver", "PointerEvent", "KeyboardEvent", "MouseEvent", "FocusEvent", "Event", "HTMLButtonElement", "SVGElement"]
    const globals = globalThis as unknown as Record<string, unknown>
    const saved = new Map<string, PropertyDescriptor | undefined>()
    const roots: ReturnType<typeof createRoot>[] = []

    before(() => {
        class Observer {
            observe(): undefined {
                return undefined
            }
            unobserve(): undefined {
                return undefined
            }
            disconnect(): undefined {
                return undefined
            }
        }
        const values: Record<string, unknown> = {
            window: dom.window,
            document: dom.window.document,
            navigator: dom.window.navigator,
            HTMLElement: dom.window.HTMLElement,
            Element: dom.window.Element,
            Node: dom.window.Node,
            IS_REACT_ACT_ENVIRONMENT: true,
            CSS: { supports: () => false, escape: (value: string) => value },
            MutationObserver: dom.window.MutationObserver,
            PointerEvent: dom.window.MouseEvent,
            KeyboardEvent: dom.window.KeyboardEvent,
            MouseEvent: dom.window.MouseEvent,
            FocusEvent: dom.window.FocusEvent,
            Event: dom.window.Event,
            HTMLButtonElement: dom.window.HTMLButtonElement,
            SVGElement: dom.window.SVGElement,
            ResizeObserver: Observer,
            getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
            requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
            cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => {
                clearTimeout(id)
            },
        }
        for (const name of borrowed) {
            saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
            Object.defineProperty(globalThis, name, { value: values[name], configurable: true, writable: true })
        }
        Object.assign(dom.window, { ResizeObserver: Observer })
    })

    after(async () => {
        await act(async () => {
            for (const root of roots) root.unmount()
            await Promise.resolve()
        })
        for (const name of borrowed) {
            const descriptor = saved.get(name)
            if (descriptor === undefined) Reflect.deleteProperty(globals, name)
            else Object.defineProperty(globalThis, name, descriptor)
        }
        dom.window.close()
    })

    const mount = async (props: MarkdownProps): Promise<HTMLElement> => {
        const host = dom.window.document.createElement("div")
        dom.window.document.body.append(host)
        const root = createRoot(host)
        roots.push(root)
        await act(async () => {
            root.render(h(Markdown, props))
            await new Promise((resolve) => setTimeout(resolve, 20))
        })
        return host
    }

    const press = async (target: Element): Promise<void> => {
        await act(async () => {
            for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) target.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true }))
            await new Promise((resolve) => setTimeout(resolve, 20))
        })
    }

    it("switches between the code and preview tabs", async () => {
        const host = await mount({ source: "::::tab\n:::code\n```tsx\n<A />\n```\n:::\n:::preview\n```mdx\n<B />\n```\n:::\n::::", renderPreview: (code) => h("output", { "data-preview": "true" }, code) })
        const tabs = [...host.querySelectorAll('[role="tab"]')]
        assert.equal(tabs.length, 2)
        assert.match(host.textContent, /<A \/>/)
        const second = tabs[1]
        assert.ok(second !== undefined)
        await press(second)
        assert.ok(host.querySelector('[data-preview="true"]') !== null, "the preview pane draws through renderPreview")
    })

    it("copies a block's code and says so in the consumer's words", async () => {
        const written: string[] = []
        Object.defineProperty(dom.window.navigator, "clipboard", {
            value: {
                writeText: (text: string) => {
                    written.push(text)
                    return Promise.resolve()
                },
            },
            configurable: true,
        })
        const host = await mount({ source: "```sh\nnpm test\n```", labels: { copy: "Copy it", copied: "Copied it" } })
        const button = [...host.querySelectorAll("button")].find((one) => one.textContent.includes("Copy it"))
        assert.ok(button !== undefined)
        await press(button)
        assert.deepEqual(written, ["npm test"])
        assert.match(host.querySelector('[role="status"]')?.textContent ?? "", /Copied it/)
    })

    it("a pressable mark reports its id, and the ref scrolls to it and focuses it", async () => {
        const source = "Alpha beta gamma."
        const pressed: string[] = []
        const scrolled: string[] = []
        const handle = createRef<MarkdownHandle>()
        Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", {
            value(this: HTMLElement) {
                scrolled.push(this.dataset.highlightId ?? "")
            },
            configurable: true,
        })
        const host = await mount({ source, highlights: [{ id: "b", ...offsetOf(source, "beta"), note: "the middle word" }], onHighlightPress: (id) => { pressed.push(id) }, ref: handle })
        const mark = host.querySelector<HTMLElement>('[data-highlight-id="b"]')
        assert.ok(mark !== null)
        assert.equal(mark.getAttribute("role"), "button")
        assert.equal(mark.getAttribute("aria-label"), "the middle word")
        await act(async () => {
            mark.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
            mark.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
            mark.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "a", bubbles: true }))
            await Promise.resolve()
        })
        assert.deepEqual(pressed, ["b", "b"])
        const api = handle.current
        assert.ok(api !== null)
        assert.equal(api.scrollToHighlight("b"), true)
        assert.equal(api.scrollToHighlight("missing"), false)
        assert.deepEqual(scrolled, ["b"])
        assert.equal(dom.window.document.activeElement, mark)
    })
})
