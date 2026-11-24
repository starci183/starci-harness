/**
 * ChoiceCard: a question with its answers as one card. The grid rule (a long answer alone on its row, two short ones together, the other cell last), the
 * arrow keys within it, aria-pressed on the chosen cell, the closed card, the destructive cell in the danger ink only, and the sheet's hairlines.
 *
 *   node --import ./specs/support/register.mts --test specs/choice-card.spec.mts
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ChoiceCard, choiceCardCellsOf, choiceCardMoveOf, type ChoiceCardProps } from "../src/core/composite/ChoiceCard/index.tsx"

const read = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8")
const OPTIONS = [
    { value: "a", label: "Số liệu một bài đăng", hint: "xong 21:19" },
    { value: "b", label: "Video ngắn" },
    { value: "c", label: "Soạn bài" },
]
const card = (props: Partial<ChoiceCardProps> = {}): string =>
    renderToStaticMarkup(createElement(ChoiceCard, { question: "Bạn đang hỏi việc nào?", options: OPTIONS, other: { label: "Việc khác…", onPress: () => undefined }, ...props }))

test("grid: a long answer fills its row, two short ones share a row, the other cell is the last full row", () => {
    const cells = choiceCardCellsOf(OPTIONS, true)
    assert.deepEqual(
        cells.map((cell) => [cell.kind, cell.row, cell.col, cell.isFull]),
        [["option", 0, 0, true], ["option", 1, 0, false], ["option", 1, 1, false], ["other", 2, 0, true]],
    )
    // a short answer with no short neighbour is alone on its row
    assert.deepEqual(choiceCardCellsOf([{ value: "x", label: "Có" }], false).map((cell) => cell.isFull), [true])
})

test("keys: right and left walk in order, down and up move by row to the nearest column, Home and End to the ends", () => {
    const cells = choiceCardCellsOf(OPTIONS, true)
    assert.equal(choiceCardMoveOf(cells, 0, "ArrowDown"), 1)
    assert.equal(choiceCardMoveOf(cells, 2, "ArrowDown"), 3)
    assert.equal(choiceCardMoveOf(cells, 2, "ArrowUp"), 0)
    assert.equal(choiceCardMoveOf(cells, 1, "ArrowRight"), 2)
    assert.equal(choiceCardMoveOf(cells, 0, "ArrowLeft"), 0)
    assert.equal(choiceCardMoveOf(cells, 0, "End"), 3)
    assert.equal(choiceCardMoveOf(cells, 3, "Home"), 0)
})

test("open: the question once, a cell per answer with its hint, aria-pressed false, one cell in the tab order", () => {
    const html = card()
    assert.equal(html.split("Bạn đang hỏi việc nào?").length - 1, 2, "the question and the group's name")
    assert.ok(html.includes('starci-core-choice-card-words"><span class="starci-core-choice-card-label">Số liệu một bài đăng</span><span class="starci-core-choice-card-hint"> · xong 21:19</span></span>'), "the label and its hint are one run of words")
    assert.equal(html.split('aria-pressed="false"').length - 1, 3)
    assert.equal(html.split('tabindex="0"').length - 1, 1)
    assert.ok(html.includes('data-other="true"') && html.includes("Việc khác…"))
})

test("chosen: the check and aria-pressed on that cell, every cell disabled", () => {
    const html = card({ chosen: "a" })
    assert.ok(html.includes('aria-pressed="true"') && html.includes('data-chosen="true"'))
    assert.ok(html.includes("starci-core-choice-card-check"))
    assert.equal(html.split("disabled").length - 1, 4)
    assert.ok(html.includes('data-closed="true"'))
})

test("destructive: the danger ink only (no Button look), and the sheet gives it no fill or edge", () => {
    const html = card({ options: [{ value: "stop", label: "Video ngắn", isDestructive: true }] })
    assert.ok(html.includes('data-destructive="true"'))
    assert.ok(!html.includes("starci-core-button"))
    const sheet = read("common/components-choice-card.css")
    assert.ok(/\[data-destructive="true"\] \{ color: var\(--danger\); \}/.test(sheet))
    assert.ok(!/data-destructive[^{]*\{[^}]*(background|border)/.test(sheet))
})

test("sheet: hairlines between rows and the two cells of a row, the control height, a focus ring, the bubble's padding off", () => {
    const sheet = read("common/components-choice-card.css")
    assert.ok(sheet.includes("border-block-start: var(--grammar-separator-edge)"))
    assert.ok(/\[data-col="1"\] \{ border-inline-start: var\(--grammar-separator-edge\); \}/.test(sheet))
    assert.ok(sheet.includes("min-block-size: var(--starci-core-control-min-size)"))
    assert.ok(/:focus-visible \{[^}]*outline: var\(--grammar-ring-width\) solid var\(--focus\)/.test(sheet))
    assert.ok(/:has\(> \.starci-core-choice-card\) \{[^}]*padding: 0;/.test(sheet))
    assert.ok(read("common/styles.css").includes('@import "./components-choice-card.css";'))
})
