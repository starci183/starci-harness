// The config an app's gallery is: the dev server the stack expects (PROJECT-GALLERY-1 item 4) and the plugin that serves the data module and the entry.
import assert from "node:assert/strict"
import path from "node:path"
import { test } from "node:test"
import { defineGallery, gallery } from "./vite.ts"

test("the dev server binds the IPv4 loopback, admits the declared hosts and does not watch the PNGs", () => {
    const config = defineGallery({ app: "demo", allowedHosts: ["demo-gallery-dev.example.org"] })
    assert.equal(config.server?.host, "127.0.0.1")
    assert.deepEqual(config.server.allowedHosts, ["demo-gallery-dev.example.org"])
    assert.deepEqual(config.server.watch?.ignored, ["**/*.png", "**/node_modules/**"])
    assert.deepEqual(defineGallery({ app: "demo" }).server?.allowedHosts, [])
})

test("the plugin resolves its data module and its entry, and nothing else", () => {
    const plugin = gallery({ app: "demo" })
    const resolve = plugin.resolveId as (id: string) => string | null
    assert.equal(resolve("virtual:starci-gallery/data"), "\0virtual:starci-gallery/data")
    const entry = resolve("/@starci-gallery/main.js") ?? ""
    assert.deepEqual([path.basename(path.dirname(entry)), path.basename(entry)], ["app", "main.js"])
    assert.equal(resolve("react"), null)
})
