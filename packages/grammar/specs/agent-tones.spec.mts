/**
 * The agent tones (Grammar 0.55.1, owner 2026-11-23: each agent has its own colour, the same on every screen): six soft pairs, none red, AA in both
 * themes, picked from the agent's stable key so the same agent always lands on the same tone, and worn alike by its Avatar and its IconTile.
 *
 *   node --import ./specs/support/register.mts --test specs/agent-tones.spec.mts
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { AGENT_TONES, agentToneOf, isAgentTone } from "../src/core/leaf/Avatar/identity.ts"
import { contrast, oklchToLab, type Lab } from "./support/color.mts"

const read = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8")
const css = read("common/tones-agent.css")

/** The token values (lightness, chroma, hue) of the light (`:root`) or the dark (`.dark`) block of the agent sheet. */
const block = (selector: RegExp): Record<string, readonly [number, number, number]> => {
    const body = selector.exec(css)?.[1] ?? ""
    return Object.fromEntries([...body.matchAll(/(--agent-[a-z]+-soft(?:-foreground)?): oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\);/gu)].map((match) => [match[1] ?? "", [Number(match[2]) / 100, Number(match[3]), Number(match[4])] as const]))
}
const THEMES = [["light", block(/:root,[^{]*\{([^}]*)\}/u)], ["dark", block(/\.dark,[^{]*\{([^}]*)\}/u)]] as const
const lab = ([l, c, h]: readonly [number, number, number]): Lab => oklchToLab(l, c, h)

test("the Common sheet imports the agent tones, in the lowest layer, with a soft pair per tone in both themes", () => {
    assert.match(read("common/styles.css"), /@import "\.\/tones-agent\.css";/u)
    assert.match(css, /@layer starci-grammar-theme \{/u)
    for (const [, theme] of THEMES) {
        assert.deepEqual(Object.keys(theme).sort(), AGENT_TONES.flatMap((tone) => [`--${tone}-soft`, `--${tone}-soft-foreground`]).sort())
    }
    for (const tone of AGENT_TONES) assert.match(css, new RegExp(`\\[data-grammar-agent-tone="${tone}"\\] \\{ --grammar-agent-soft: var\\(--${tone}-soft\\); --grammar-agent-soft-foreground: var\\(--${tone}-soft-foreground\\); \\}`, "u"))
})

test("every agent ink reaches 4.5:1 on its plate in both themes", () => {
    for (const [name, theme] of THEMES) {
        for (const tone of AGENT_TONES) {
            const ratio = contrast(lab(theme[`--${tone}-soft`] ?? [0, 0, 0]), lab(theme[`--${tone}-soft-foreground`] ?? [0, 0, 0]))
            assert.ok(ratio >= 4.5, `${name} ${tone}: ${ratio.toFixed(2)}:1`)
        }
    }
})

test("no agent tone is red: every hue stands at least 40 degrees from the danger hue (38) and the red of a brand (0 to 30)", () => {
    for (const [, theme] of THEMES) {
        for (const tone of AGENT_TONES) {
            const hue = (theme[`--${tone}-soft-foreground`] ?? [0, 0, 0])[2]
            const distance = (target: number): number => Math.min(Math.abs(hue - target), 360 - Math.abs(hue - target))
            assert.ok(Math.min(distance(38), distance(15)) >= 40, `${tone} hue ${String(hue)}`)
        }
    }
})

test("an agent keeps its tone: the same key always lands on the same tone, its spaces trimmed, and keys spread over the palette", () => {
    assert.equal(agentToneOf("ads"), agentToneOf("ads"))
    assert.equal(agentToneOf(" ads "), agentToneOf("ads"))
    assert.ok(isAgentTone(agentToneOf("reception")))
    assert.equal(isAgentTone("danger"), false)
    const seen = new Set(Array.from({ length: 60 }, (_, index) => agentToneOf(`agent-${String(index)}`)))
    assert.equal(seen.size, AGENT_TONES.length)
})

test("the Avatar of an agent and its IconTile wear the agent tone through one attribute", () => {
    const avatar = read("core/leaf/Avatar/index.tsx")
    assert.match(avatar, /kind === "agent" && tone === "default" && mark === undefined \? "agent" : tone/u)
    assert.match(avatar, /"data-grammar-agent-tone": agentToneOf\(seed \?\? name\)/u)
    assert.match(read("core/leaf/IconTile/index.tsx"), /isAgentTone\(tone\) \? \{ "data-grammar-agent-tone": tone \}/u)
    const styles = read("common/styles.css")
    assert.match(styles, /\.starci-core-icon-tile\[data-grammar-agent-tone\]\[data-artwork="false"\]\[data-loading="false"\] \{\s*background: var\(--grammar-agent-soft\);\s*color: var\(--grammar-agent-soft-foreground\);/u)
    assert.match(styles, /\[data-grammar-avatar-tone="agent"\] \[data-grammar-avatar-fallback="true"\] \{[^}]*background: var\(--grammar-agent-soft\);/u)
})
