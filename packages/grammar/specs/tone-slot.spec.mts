/**
 * The tone slot (Grammar 0.55.1, owner 2026-11-23 "Chuyển về NIVO"): an app's identity palette is the app's; the Grammar takes a soft pair by slot
 * (`tone={{ soft, ink }}`) on an Avatar, an AvatarGroup item and an IconTile, and owns no palette of agents or anything else.
 *
 *   node --import ./specs/support/register.mts --test specs/tone-slot.spec.mts
 */
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { StarIcon } from "@heroicons/react/24/outline"
import { Avatar } from "../src/core/leaf/Avatar/index.tsx"
import { AvatarGroup } from "../src/core/composite/AvatarGroup/index.tsx"
import { IconTile } from "../src/core/leaf/IconTile/index.tsx"
import { isToneSlot, toneSlotStyle } from "../src/core/toneSlot.ts"

const read = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8")
const render = (node: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(node)
const SLOT = { soft: "var(--app-room-soft)", ink: "var(--app-room-ink)" } as const
const VARS = /--grammar-tone-slot-soft:\s*var\(--app-room-soft\);\s*--grammar-tone-slot-ink:\s*var\(--app-room-ink\)/u

test("a slot is an object with a soft and an ink; a word is a named tone", () => {
    assert.equal(isToneSlot(SLOT), true)
    assert.equal(isToneSlot("accent"), false)
    assert.equal(isToneSlot({ soft: "red" }), false)
    assert.deepEqual(toneSlotStyle(SLOT), { "--grammar-tone-slot-soft": SLOT.soft, "--grammar-tone-slot-ink": SLOT.ink })
})

test("an Avatar with a slot draws its letters (no generated image) on the slot's pair, a person or an agent alike", () => {
    for (const kind of ["person", "agent"] as const) {
        const markup = render(createElement(Avatar, { name: "Lan Anh", kind, tone: SLOT }))
        assert.match(markup, /data-grammar-avatar-tone="slot"/u, kind)
        assert.match(markup, VARS, kind)
        assert.match(markup, />LA</u, kind)
        assert.doesNotMatch(markup, /data:image\/svg/u, kind)
    }
})

test("without a tone an agent's avatar is the generated image like a person's: the Grammar gives no agent its own plate", () => {
    const markup = render(createElement(Avatar, { name: "Claude", kind: "agent", seed: "claude" }))
    assert.match(markup, /data-grammar-avatar-tone="default"/u)
    assert.match(markup, /data:image\/svg/u)
    assert.doesNotMatch(markup, /data-grammar-agent-tone/u)
})

test("an AvatarGroup item's slot reaches the row, the grid tile and the member list", () => {
    const items = [{ id: "a", name: "Lan Anh", kind: "agent" as const, tone: SLOT }, { id: "b", name: "Minh" }]
    for (const layout of ["row", "grid"] as const) {
        const markup = render(createElement(AvatarGroup, { label: "team", items, layout, overflowLabel: (n: number) => `+${String(n)}` }))
        assert.equal(markup.match(/data-grammar-avatar-tone="slot"/gu)?.length, 1, layout)
        assert.match(markup, VARS, layout)
        assert.match(markup, />LA</u, layout)
    }
})

test("an IconTile with a slot paints its glyph on the pair; a status mark ignores the slot", () => {
    const tile = render(createElement(IconTile, { source: StarIcon, tone: SLOT }))
    assert.match(tile, /data-tone="slot"/u)
    assert.match(tile, VARS)
    assert.doesNotMatch(tile, /data-grammar-tone-custom/u)
    const status = render(createElement(IconTile, { state: "done", tone: SLOT }))
    assert.doesNotMatch(status, /data-tone="slot"|--grammar-tone-slot/u)
})

test("the sheet reads the two variables for a lone avatar, a grid tile and a tile; no agent palette is left in the Grammar", () => {
    const styles = read("common/styles.css")
    assert.match(styles, /:is\(\.starci-core-avatar, \.starci-core-avatar-group-member\)\[data-grammar-avatar-tone="slot"\] \[data-grammar-avatar-fallback="true"\] \{[^}]*background: var\(--grammar-tone-slot-soft\);\s*color: var\(--grammar-tone-slot-ink\);/u)
    assert.match(styles, /\.starci-core-icon-tile\[data-tone="slot"\]\[data-artwork="false"\]\[data-loading="false"\] \{\s*background: var\(--grammar-tone-slot-soft\);\s*color: var\(--grammar-tone-slot-ink\);/u)
    assert.equal(existsSync(new URL("../src/common/tones-agent.css", import.meta.url)), false)
    const sources = [styles, read("core/leaf/Avatar/identity.ts"), read("core/leaf/Avatar/index.tsx"), read("core/leaf/IconTile/index.tsx"), read("core/composite/AvatarGroup/index.tsx"), read("common/renderers-navigation.ts")].join("\n")
    assert.doesNotMatch(sources, /agentToneOf|AGENT_TONES|isAgentTone|--agent-[a-z]+-soft|data-grammar-agent-tone|avatar-tone="agent"/u)
})
