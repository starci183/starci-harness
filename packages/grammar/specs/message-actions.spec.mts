/**
 * MessageActions (Grammar 0.55.0): the hover rail of a chat message. Which side, ghost sm icon-only buttons, the names the app passes, when the rail shows
 * (hover, long press, keyboard focus inside), the 120ms fade that stops under reduced motion, the floating picker, the bubble integration.
 *
 *   node --import ./specs/support/register.mts --test specs/message-actions.spec.mts
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { LoadingScope } from "../src/core/regionScope.tsx"
import { MessageActions, type MessageActionsProps } from "../src/core/composite/MessageActions/index.tsx"
import { MESSAGE_REACTION_PICKER_EMOJI, messageActionsEdge, messageActionsMenuPlacement, messageActionsPickerPlacement } from "../src/core/composite/MessageActions/logic.ts"
import { MessageBubble } from "../src/core/composite/MessageBubble/index.tsx"

const read = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8")
const labels = { react: "Bày tỏ cảm xúc", reply: "Trả lời", more: "Thêm", picker: "Chọn cảm xúc", reactWith: (emoji: string) => `Bày tỏ ${emoji}`, allEmoji: "Tất cả cảm xúc" }
const rail = (props: Partial<MessageActionsProps> = {}): string => renderToStaticMarkup(createElement(MessageActions, {
    side: "incoming", labels, onReact: () => undefined, onReply: () => undefined,
    menu: [{ id: "copy", label: "Sao chép" }, { id: "pin", label: "Ghim tin nhắn" }], ...props,
}))
const buttons = (markup: string): string[] => markup.match(/<button\b[^>]*>/g) ?? []

test("side: the rail is on the end of someone else's or an agent's bubble and on the start of the viewer's own", () => {
    assert.equal(messageActionsEdge("incoming"), "end")
    assert.equal(messageActionsEdge("outgoing"), "start")
    assert.ok(rail({ side: "incoming" }).includes('data-grammar-message-actions-edge="end"'))
    assert.ok(rail({ side: "outgoing" }).includes('data-grammar-message-actions-edge="start"'))
    const sheet = read("common/components-message-actions.css")
    assert.ok(/\[data-grammar-message-actions-edge="end"\]\s*\{\s*inset-inline-start: calc\(100% \+ var\(--grammar-inline-gap\)\)/.test(sheet))
    assert.ok(/\[data-grammar-message-actions-edge="start"\]\s*\{\s*inset-inline-end: calc\(100% \+ var\(--grammar-inline-gap\)\)/.test(sheet))
    assert.ok(/inset-block: 0;[^}]*align-items: center/.test(sheet), "centred on the bubble")
})

test("actions: react, reply and more, in that order, each HeroUI's own ghost sm icon-only Button with a 16px icon and the app's name", () => {
    const found = buttons(rail())
    assert.equal(found.length, 3)
    const expected = [["react", "Bày tỏ cảm xúc"], ["reply", "Trả lời"], ["more", "Thêm"]] as const
    expected.forEach(([action, name], index) => {
        const button = found[index] ?? ""
        assert.ok(button.includes(`data-grammar-message-action="${action}"`), button)
        for (const klass of ["button", "button--ghost", "button--sm", "button--icon-only"]) assert.ok(new RegExp(`class="[^"]*\\b${klass}\\b`).test(button), `${action} ${klass}`)
        assert.ok(button.includes(`aria-label="${name}"`), action)
        assert.ok(!/\b(style|data-variant|data-size)=/.test(button), "used as shipped: no inline style or restyle")
    })
    const html = rail()
    assert.equal(html.match(/data-usage="chip"/g)?.length, 3, "three icons")
    assert.ok(!/button--(primary|secondary|tertiary|outline|danger|md|lg)/.test(html))
    // The glyph keeps the sm Button's own scale (16), not the text icon sizes (situations.md "Icon and mark sizes").
    const sheet = read("common/components-message-actions.css")
    assert.ok(/\.starci-core-message-actions \.starci-core-icon\s*\{\s*width: 1rem;\s*height: 1rem;/.test(sheet), "the sm Button glyph is 16px")
})

test("actions: the sheet adds no colour, radius or hover style to the buttons (only the open trigger keeps the vendor hover fill)", () => {
    const sheet = read("common/components-message-actions.css")
    const buttonRules = [...sheet.matchAll(/([^{}]*)\{([^}]*)\}/g)].filter((match) => /\[data-grammar-message-action\]/.test(match[1] ?? ""))
    assert.equal(buttonRules.length, 1)
    assert.equal((buttonRules[0]?.[2] ?? "").trim(), "background: var(--button-bg-hover);")
    assert.ok((buttonRules[0]?.[1] ?? "").includes('[aria-expanded="true"]'))
})

test("actions: reply and more appear only when the app gives them; the labels are all the app's", () => {
    assert.equal(buttons(rail({ onReply: undefined as never })).length, 2)
    assert.equal(buttons(rail({ menu: [] })).length, 2)
    assert.equal(buttons(rail({ menu: undefined as never, onReply: undefined as never })).length, 1)
    const source = read("core/composite/MessageActions/index.tsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    assert.ok(!/[ăâđêôơưàáảãạ]/iu.test(source), "no Vietnamese literal in the component code")
})

test("picker: six emoji in the owner's order, opening above the react button over the bubble (end for others, start for own); the menu opens below", () => {
    assert.deepEqual([...MESSAGE_REACTION_PICKER_EMOJI], ["❤️", "😆", "😮", "😢", "😡", "👍"])
    assert.equal(messageActionsPickerPlacement("incoming"), "top end")
    assert.equal(messageActionsPickerPlacement("outgoing"), "top start")
    assert.equal(messageActionsMenuPlacement("incoming"), "bottom end")
    assert.equal(messageActionsMenuPlacement("outgoing"), "bottom start")
})

test("picker: a floating popover pill (popover elevation, no border, surface ground, fully rounded), 28px emoji in 40px cells, a slight hover grow", () => {
    const sheet = read("common/components-message-actions.css")
    const pill = /\.starci-core-message-reactions\s*\{([^}]*)\}/.exec(sheet)?.[1] ?? ""
    assert.ok(pill.includes("border: 0;"))
    assert.ok(pill.includes("border-radius: var(--grammar-radius-pill);"))
    assert.ok(pill.includes("background: var(--surface);"))
    assert.ok(pill.includes("box-shadow: var(--grammar-shadow-popover)"))
    const ramps = read("common/ramps.css")
    assert.ok(/--grammar-message-emoji-size:\s*1\.75rem;/.test(ramps), "28px")
    assert.ok(/--grammar-message-emoji-cell:\s*var\(--starci-core-control-min-size\);/.test(ramps) && /--starci-core-control-min-size:\s*2\.5rem;/.test(ramps), "40px")
    assert.ok(/--grammar-message-emoji-grow:\s*1\.1\d*;/.test(ramps))
    assert.ok(/\.starci-core-message-reactions-emoji:is\(:hover, :focus-visible\) > span\s*\{\s*transform: scale\(var\(--grammar-message-emoji-grow\)\)/.test(sheet))
})

test("picker: Esc and an outside press close it, because it is a React Aria popover whose open state the rail owns", () => {
    const source = read("core/composite/MessageActions/index.tsx")
    assert.ok(/<HeroPopover \{\.\.\.overlayOpenProps\(\{ isOpen: pickerOpen, onOpenChange: setPickerOpen \}\)\}>/.test(source), "controlled by the rail, closed by the popover's own dismiss")
    assert.ok(/<HeroPopover\.Content[\s\S]*UNSTABLE_portalContainer/.test(source), "portals into the Grammar root")
    assert.ok(!/isNonModal|shouldCloseOnInteractOutside/.test(source), "no dismiss behaviour switched off")
})

test("visibility: hidden until hover (a pointer that can hover), a long press, keyboard focus inside the message, or an open picker or menu", () => {
    const sheet = read("common/components-message-actions.css")
    const base = /\.starci-core-message-actions\s*\{([^}]*)\}/.exec(sheet)?.[1] ?? ""
    assert.ok(base.includes("opacity: 0;"))
    assert.ok(base.includes("pointer-events: none;"))
    const shown = /([^{}]*)\{\s*opacity: 1;\s*pointer-events: auto;\s*\}/g
    const selectors = [...sheet.matchAll(shown)].map((match) => match[1] ?? "").join("\n")
    for (const needle of [":focus-within", 'data-grammar-message-actions-open="true"', 'data-grammar-message-actions-visible="true"', 'data-grammar-bubble-picking="true"', ":hover"]) assert.ok(selectors.includes(needle), needle)
    const hover = /@media \(hover: hover\) \{([\s\S]*?)\n    \}/.exec(sheet)?.[1] ?? ""
    assert.ok(hover.includes(":hover .starci-core-message-actions"), "hover reveals only where a pointer can hover")
    assert.ok(!/visibility:/.test(sheet.split(".starci-core-message-reactions")[0] ?? ""), "opacity, never visibility: a hidden rail stays reachable, and focus reveals it")
})

test("visibility: keyboard focus on any rail button, or on the message, shows the rail (focus-within on the rail, the bubble and the host)", () => {
    const sheet = read("common/components-message-actions.css")
    assert.ok(/\.starci-core-message-actions:is\(:focus-within,/.test(sheet))
    assert.ok(/:is\(\.starci-core-message-bubble, \[data-grammar-message-actions-host\]\):focus-within \.starci-core-message-actions/.test(sheet))
    assert.ok(rail({ isVisible: true }).includes('data-grammar-message-actions-visible="true"'))
    assert.ok(rail().includes('data-grammar-message-actions-visible="false"'))
    assert.ok(!/tabindex="-1"/.test(rail()), "hidden or not, every button is a tab stop")
})

test("fade: 120ms opacity, and nothing moves under reduced motion", () => {
    const sheet = read("common/components-message-actions.css")
    assert.ok(/--grammar-message-actions-fade:\s*120ms;/.test(read("common/ramps.css")))
    assert.ok(/transition: opacity var\(--grammar-message-actions-fade\)/.test(sheet))
    const reduced = [...sheet.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n    \}/g)].map((match) => match[1] ?? "").join("\n")
    assert.ok(/\.starci-core-message-actions\s*\{\s*transition: none;/.test(reduced))
    assert.ok(/\.starci-core-message-reactions-emoji:is\(:hover, :focus-visible\) > span\s*\{\s*transform: none;/.test(reduced))
})

test("loading: while its region loads the rail draws nothing (no control exists to skeleton)", () => {
    assert.equal(renderToStaticMarkup(createElement(LoadingScope, { isLoading: true, children: createElement(MessageActions, { side: "incoming", labels, onReact: () => undefined, onReply: () => undefined }) })), "")
})

test("MessageBubble: the bubble gives the rail its side and a line of its own, and keeps the chosen-reaction chip on the bubble's bottom corner", () => {
    const bubble = (side: "incoming" | "outgoing") => renderToStaticMarkup(createElement(MessageBubble, {
        body: "Chào", side, reactions: [{ emoji: "❤️", count: 1, mine: true }],
        messageActions: { labels, onReact: () => undefined, onReply: () => undefined, menu: [{ id: "copy", label: "Sao chép" }] },
    }))
    const incoming = bubble("incoming")
    assert.ok(incoming.includes('class="starci-core-message-bubble-line"'))
    assert.ok(incoming.includes('data-grammar-message-actions-edge="end"') && incoming.includes('data-grammar-message-actions-side="incoming"'))
    assert.ok(bubble("outgoing").includes('data-grammar-message-actions-edge="start"'))
    assert.ok(incoming.includes('data-grammar-reaction-pill="true"'), "the chip")
    assert.ok(/starci-core-reaction-pill\s*\{[^}]*inset-block-end: -0\.75rem/.test(read("common/styles.css")), "on the bottom corner")
    assert.ok(!renderToStaticMarkup(createElement(MessageBubble, { body: "Chào" })).includes("starci-core-message-actions"), "no rail without messageActions")
})
