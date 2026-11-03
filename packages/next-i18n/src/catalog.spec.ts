import assert from "node:assert/strict"
import test from "node:test"
import { fallbackText, messagesOf } from "./catalog.ts"

test("FE-I18N-3: a catalog module is read by its default export, and anything else is refused", () => {
    assert.deepEqual(messagesOf({ default: { home: { title: "Home" } } }), { home: { title: "Home" } })
    assert.throws(() => messagesOf({ home: {} }), TypeError)
    assert.throws(() => messagesOf(null), TypeError)
    assert.throws(() => messagesOf("home"), TypeError)
    assert.throws(() => messagesOf({ default: ["home"] }), TypeError)
    assert.throws(() => messagesOf({ default: null }), TypeError)
})

test("a missing key renders as <app>:<namespace>.<key>", () => {
    assert.equal(fallbackText("web", { namespace: "home", key: "title" }), "web:home.title")
    assert.equal(fallbackText("web", { key: "title" }), "web:.title")
})
