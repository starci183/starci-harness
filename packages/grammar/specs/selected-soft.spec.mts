/**
 * The selected state of navigation items and selectable list rows is the accent soft pair with NO one-sided edge bar; hover is the neutral soft fill.
 *
 *   node --import ./specs/support/register.mts --test specs/selected-soft.spec.mts
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8")
const styles = read("common/styles.css")
const navigation = read("common/components-navigation.css")
const hooks = read("common/theme-hooks.json")

/** The declarations of the first rule whose selector list contains `selector`. */
const rule = (css: string, selector: string): string => {
    const at = css.indexOf(selector)
    assert.ok(at >= 0, `${selector} is styled`)
    return css.slice(css.indexOf("{", at), css.indexOf("}", at))
}

test("the selected sidebar item, list option and table rows take the accent soft pair", () => {
    assert.match(rule(styles, '.starci-core-sidebar-item[data-selected="true"],'), /var\(--accent-soft\)/u)
    assert.match(rule(navigation, '.starci-core-list-box-item:is([aria-selected="true"], [data-selected="true"]),'), /background: var\(--accent-soft\)/u)
    assert.match(rule(navigation, '.starci-core-data-table-row[data-grammar-selected="true"] {'), /background: var\(--accent-soft\)/u)
    assert.match(rule(navigation, '.starci-core-data-table-list-row[data-grammar-selected="true"] {'), /color: var\(--accent-soft-foreground\)/u)
})

test("no selected item draws an edge bar and the bar hooks are gone", () => {
    assert.doesNotMatch(styles, /sidebar-bar|sidebar-selected-start-radius/u)
    assert.doesNotMatch(hooks, /sidebar-bar|sidebar-selected-start-radius/u)
    assert.doesNotMatch(rule(navigation, '.starci-core-data-table-list-row[data-grammar-selected="true"] {'), /box-shadow/u)
    assert.doesNotMatch(navigation, /data-grammar-selected="true"\]\s*>\s*:first-child/u)
})

test("hover is the neutral soft fill and a selected row under the pointer keeps its own", () => {
    assert.match(rule(styles, '.starci-core-sidebar-item[data-hovered="true"] {'), /var\(--default\)/u)
    assert.match(navigation, /\[data-grammar-table-row-pressable="true"\]:not\(\[data-grammar-selected="true"\]\):hover/u)
})
