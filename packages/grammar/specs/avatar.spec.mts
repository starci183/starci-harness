/**
 * Avatar and AvatarGroup (Grammar 0.55.0): the initials rule, the colour a name always gets, its contrast, the group of round people and marks and its overflow rule,
 * the AI Chip that follows a name (AgentName), and no AI pill on the avatar.
 *
 *   node --import ./specs/support/register.mts --test specs/avatar.spec.mts
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { AVATAR_INKS, AVATAR_PALETTE, avatarClusterCells, avatarGroupTiles, avatarHue, avatarInitials, avatarInk } from "../src/core/leaf/Avatar/identity.ts"
import { avatarSvg } from "../src/core/leaf/Avatar/dicebear.ts"
import { avatarGroupSlots } from "../src/core/leaf/Avatar/identity.ts"
import { Avatar, CHANNEL_LOGOS } from "../src/core/leaf/Avatar/index.tsx"
import { AgentName } from "../src/core/leaf/AgentName/index.tsx"
import { ListRow } from "../src/core/composite/ListRow/index.tsx"
import { MessageBubble } from "../src/core/composite/MessageBubble/index.tsx"
import { SurfaceCard } from "../src/core/frame/SurfaceCard/index.tsx"
import { ListBox } from "../src/core/branch/ListBox/index.tsx"
import { AvatarGroup } from "../src/core/composite/AvatarGroup/index.tsx"
import { contrast, hexToLab, labToHex, oklchToLab, type Lab } from "./support/color.mts"

const read = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8")
const render = (node: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(node)
/** The SVG of every generated avatar image in a markup, decoded: what DiceBear drew. */
const images = (markup: string): string[] => [...markup.matchAll(/src="data:image\/svg\+xml;utf8,([^"]+)"/g)].map((match) => decodeURIComponent((match[1] ?? "").replaceAll("&amp;", "&")))
const lettersOf = (svg: string): string => />([^<>]+)<\/text>/.exec(svg)?.[1] ?? ""
/** What each round item reads, in order: the letters of a generated initials image, or the "+N" of the muted overflow mark. */
const letters = (markup: string): string[] => [...markup.matchAll(/src="data:image\/svg\+xml;utf8,([^"]+)"|data-grammar-avatar-overflow-mark="muted">([^<]+)</g)]
    .map((match) => match[2] ?? lettersOf(decodeURIComponent((match[1] ?? "").replaceAll("&amp;", "&"))))
const fillOf = (svg: string): string => /<rect width="100" height="100" fill="(#[0-9a-f]{6})"\/>/.exec(svg)?.[1] ?? ""

test("initials: a Vietnamese name is the family name's first letter and the given name's, diacritics kept and uppercased", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
        ["Nguyễn Văn An", "NA"],
        ["Đỗ Thị Hoa", "ĐH"],
        ["Lê Quang Đạt", "LĐ"],
        ["Trần Bình", "TB"],
        ["Mai Lan Anh Thư", "MT"],
        ["ngô ánh", "NÁ"],
        ["Ưng Ế", "ƯẾ"],
    ]
    for (const [name, expected] of cases) assert.equal(avatarInitials(name), expected, name)
})

test("initials: a single word gives its first two letters, one letter gives one, nothing readable gives ?", () => {
    assert.equal(avatarInitials("Nivo"), "NI")
    assert.equal(avatarInitials("Ánh"), "ÁN")
    assert.equal(avatarInitials("đạt"), "ĐẠ")
    assert.equal(avatarInitials("A"), "A")
    assert.equal(avatarInitials(""), "?")
    assert.equal(avatarInitials("  - & "), "?")
})

test("initials: other scripts and punctuation: words without a letter are skipped, the middle never counts", () => {
    assert.equal(avatarInitials("Claude Agent"), "CA")
    assert.equal(avatarInitials("(AI) Bot"), "AB")
    assert.equal(avatarInitials("  Trần   Văn  -  Bình  "), "TB")
    assert.equal(avatarInitials("Nguyễn Văn A"), "NA")
})

test("initials: a decomposed name (letter + combining marks) gives the same initials as the composed one, the diacritic on its letter", () => {
    const decomposed = "Ế Minh".normalize("NFD")
    assert.notEqual(decomposed, "Ế Minh")
    assert.equal(avatarInitials(decomposed), "ẾM")
    assert.equal(avatarInitials("Nguyễn Văn An".normalize("NFD")), avatarInitials("Nguyễn Văn An"))
    assert.equal(avatarInitials("Đỗ Hoa".normalize("NFD")), "ĐH")
})

test("colour: a name always gets the same palette entry, however it is typed", () => {
    const hue = avatarHue("Nguyễn Văn An")
    assert.equal(avatarHue("Nguyễn Văn An"), hue)
    assert.equal(avatarHue("  nguyễn văn an "), hue)
    assert.equal(avatarHue("Nguyễn Văn An".normalize("NFD")), hue)
    assert.ok(Number.isInteger(hue) && hue >= 0 && hue < AVATAR_PALETTE.length)
})

test("colour: the hash is pinned, so a colour never changes between releases", () => {
    assert.deepEqual(["Nguyễn Văn An", "Trần Bình", "Claude", "u_8f2a"].map(avatarHue), [7, 2, 7, 6])
})

test("colour: names spread over the palette (no entry is starved, none takes more than a quarter)", () => {
    const counts = new Array<number>(AVATAR_PALETTE.length).fill(0)
    const total = 800
    for (let index = 0; index < total; index += 1) counts[avatarHue(`member ${index} ${index * 7919}`)] = (counts[avatarHue(`member ${index} ${index * 7919}`)] ?? 0) + 1
    for (const count of counts) assert.ok(count > total / AVATAR_PALETTE.length / 2 && count < total / 4, counts.join(","))
})

test("colour: the seed wins over the name, in the markup", () => {
    const html = (props: { name: string; seed?: string }) => render(createElement(Avatar, props))
    const hueOf = (markup: string): string => /data-grammar-avatar-hue="(\d)"/.exec(markup)?.[1] ?? ""
    assert.equal(hueOf(html({ name: "Shop A", seed: "id-1" })), hueOf(html({ name: "Shop B", seed: "id-1" })))
    assert.equal(hueOf(html({ name: "Shop A", seed: "id-1" })), String(avatarHue("id-1")))
    assert.equal(hueOf(html({ name: "Shop A" })), String(avatarHue("Shop A")))
})

/** The theme's tokens (the light block, then the dark block over it) with `var()` resolved. */
const themeTokens = (mode: "light" | "dark"): ((name: string) => Lab) => {
    const css = read("core/theme.css")
    const block = (opener: RegExp): Map<string, string> => {
        const start = (opener.exec(css)?.index ?? -1)
        assert.ok(start >= 0)
        const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start))
        return new Map([...body.matchAll(/(--[a-z-]+):\s*([^;]+);/g)].map((match) => [match[1] ?? "", (match[2] ?? "").trim()]))
    }
    const tokens = new Map(block(/:root,\s*\n\s*\.light/))
    if (mode === "dark") for (const [key, value] of block(/\.dark,\s*\n\s*\[data-theme="dark"\]/)) tokens.set(key, value)
    const resolve = (name: string): Lab => {
        const value = tokens.get(name)
        if (value === undefined) throw new Error(`theme.css defines no ${name} in ${mode}`)
        const reference = /^var\((--[a-z-]+)\)$/.exec(value)
        if (reference !== null) return resolve(reference[1] ?? "")
        const oklch = /^oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)$/.exec(value)
        if (oklch !== null) return oklchToLab(Number(oklch[1]) / 100, Number(oklch[2]), Number(oklch[3]))
        if (/^#[0-9a-f]{3,6}$/i.test(value)) return hexToLab(value)
        throw new Error(`cannot read ${name}: ${value}`)
    }
    return resolve
}

test("palette: every entry is a Grammar theme tone, as the hex that token resolves to in its theme", () => {
    for (const entry of AVATAR_PALETTE) {
        assert.equal(labToHex(themeTokens(entry.mode)(entry.token)), entry.hex, `${entry.mode} ${entry.token}`)
    }
    assert.equal(new Set(AVATAR_PALETTE.map((entry) => entry.hex)).size, AVATAR_PALETTE.length)
})

test("palette: the letter colour ACTUALLY drawn keeps WCAG AA contrast (4.5:1) on every one of the 8 entries", () => {
    assert.equal(AVATAR_PALETTE.length, 8)
    for (const entry of AVATAR_PALETTE) {
        const ink = avatarInk(entry.hex)
        const ratio = contrast(hexToLab(entry.hex), hexToLab(ink))
        assert.ok(ratio >= 4.5, `${entry.hex} with ${ink}: ${ratio.toFixed(2)}`)
        // The image carries that ink, not the style's own contrastTo pick (which put dark letters on dark plates).
        const seed = Array.from({ length: 400 }, (_, i) => `seed-${String(i)}`).find((candidate) => AVATAR_PALETTE[avatarHue(candidate)]?.hex === entry.hex) ?? ""
        const drawn = /<text [^>]*fill="(#[0-9a-f]{6})"/.exec(avatarSvg("Sales AI", seed))?.[1] ?? ""
        assert.equal(drawn, ink, `${entry.hex}: drawn ${drawn}`)
    }
})

test("palette: the image is DiceBear Initials with the seed's palette entry as its background and the right letters", () => {
    const [svg] = images(render(createElement(Avatar, { name: "Lan Nguyễn", seed: "member-42" })))
    assert.ok(svg !== undefined)
    assert.equal(lettersOf(svg), "LN")
    assert.equal(fillOf(svg), AVATAR_PALETTE[avatarHue("member-42")]?.hex)
    const ink = /<text [^>]*fill="(#[0-9a-f]{6})"/.exec(svg)?.[1] ?? ""
    assert.ok(([AVATAR_INKS.light, AVATAR_INKS.dark] as readonly string[]).includes(ink), "white on a dark tone, a dark tint on a light one")
})

test("seed: the colour follows the stable id, not the name, so a rename keeps it", () => {
    const fill = (name: string, seed: string): string => fillOf(images(render(createElement(Avatar, { name, seed })))[0] ?? "")
    assert.equal(fill("Lan Nguyễn", "member-42"), fill("Lan Anh", "member-42"))
    assert.equal(lettersOf(images(render(createElement(Avatar, { name: "Lan Anh", seed: "member-42" })))[0] ?? ""), "LA")
})

test("group tiling: one member fills, two are halves, three are a half and two quarters, four are quarters, five and more end in +N", () => {
    const shape = (total: number) => avatarGroupTiles(total).map((tile) => (tile.kind === "member" ? `m${tile.index}` : `+${tile.count}`)).join(" ")
    assert.equal(shape(0), "")
    assert.equal(shape(1), "m0")
    assert.equal(shape(2), "m0 m1")
    assert.equal(shape(3), "m0 m1 m2")
    assert.equal(shape(4), "m0 m1 m2 m3")
    assert.equal(shape(5), "m0 m1 m2 +2")
    assert.equal(shape(9), "m0 m1 m2 +6")
})

const people = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `p${index}`, name: ["Nguyễn Văn An", "Trần Bình", "Đỗ Thị Hoa", "Lê Quang Đạt", "Phạm Mai", "Vũ Lan", "Hồ Tâm"][index % 7] ?? "?" }))
const group = (count: number, extra: Record<string, unknown> = {}): string =>
    render(createElement(AvatarGroup, { label: "Nhóm", items: people(count), layout: "grid", overflowLabel: (hidden: number) => `${hidden} người khác`, ...extra }))
const cells = (markup: string): string => /data-grammar-avatar-cells="(\d+)"/.exec(markup)?.[1] ?? ""

test("group: the cluster in the markup, each member round with its initials and colour; four or more are three members and the headcount", () => {
    for (const [count, expected] of [[1, "1"], [2, "2"], [3, "3"], [4, "4"], [5, "4"], [12, "4"]] as const) assert.equal(cells(group(count)), expected, `${count} members`)
    const three = group(3)
    const drawn = images(three)
    assert.deepEqual(drawn.map(lettersOf), ["NA", "TB", "ĐH"])
    assert.ok(!three.includes("data-grammar-avatar-count"))
    people(3).forEach((member, index) => assert.equal(fillOf(drawn[index] ?? ""), AVATAR_PALETTE[avatarHue(member.name)]?.hex, member.name))
    assert.deepEqual(letters(group(4)), ["NA", "TB", "ĐH", "4"], "four members: three drawn and the count cell reads 4")
})

test("group: the cluster's slots (Zalo): two on the diagonal, three as two over one, four or more as three and the count (owner 2026-11-26)", () => {
    const slots = (count: number): string[] => avatarClusterCells(count).map((cell) => cell.slot)
    assert.deepEqual(slots(1), ["whole"])
    assert.deepEqual(slots(2), ["top-start", "bottom-end"])
    assert.deepEqual(slots(3), ["top-start", "top-end", "bottom-centre"])
    assert.deepEqual(slots(4), ["top-start", "top-end", "bottom-start", "bottom-end"])
    assert.deepEqual(slots(29), slots(4))
    assert.deepEqual(avatarClusterCells(29).at(-1), { kind: "count", total: 29, hidden: 26, slot: "bottom-end" })
    assert.deepEqual(avatarClusterCells(0), [])
    for (const count of [2, 3, 5]) {
        const html = group(count)
        const marked = [...html.matchAll(/data-grammar-cluster-slot="([a-z-]+)"/g)].map((match) => match[1])
        assert.deepEqual(marked, slots(count), `${count} members: each cell names its slot in the markup`)
    }
})

test("group: the cluster is not one circle: no clip, no radius on the group, every member and the count cell its own circle", () => {
    const css = read("common/components-avatar-group.css")
    const cluster = /\.starci-core-avatar-cluster \{([^}]*)\}/u.exec(css)?.[1] ?? ""
    assert.ok(cluster.length > 0)
    assert.doesNotMatch(cluster, /overflow|border-radius/u, "the cluster itself neither clips nor rounds")
    const member = /\.starci-core-avatar-cluster > :is\(\.starci-core-avatar-group-member, \.starci-core-avatar-group-count\) \{([^}]*)\}/u.exec(css)?.[1] ?? ""
    assert.match(member, /border-radius: var\(--grammar-radius-round\) !important;/u)
    assert.match(member, /aspect-ratio: 1 \/ 1;/u)
    assert.ok(!/avatar-group-grid/u.test(css), "the old clipped grid is gone")
    assert.ok(!group(5).includes("starci-core-avatar-group-grid"))
})

test("group: a group photo overrides the cluster: one round Avatar of the same size named by the label", () => {
    const html = group(5, { photo: "https://example.com/group.png" })
    assert.ok(html.includes('data-grammar-avatar-photo="true"') && html.includes('data-grammar-avatar-cells="1"'))
    assert.ok(!html.includes("data-grammar-cluster-slot") && !html.includes("data-grammar-avatar-count"), "no member and no count while a photo stands")
    assert.ok(html.includes('aria-label="Nhóm"'), "the group is still named by its label")
})

test("group: five or more members: the count cell reads the headcount (5, 7), its label counts those not drawn", () => {
    const five = group(5)
    assert.ok(five.includes("data-grammar-avatar-count"))
    assert.deepEqual(letters(five), ["NA", "TB", "ĐH", "5"])
    assert.deepEqual(letters(group(7)).slice(-1), ["7"])
    assert.ok(five.includes('aria-label="2 người khác"'))
})

test("group: the name lists the members from the app's own copy (A, B và 3 người khác); Grammar writes no sentence", () => {
    const describe = (shown: ReadonlyArray<string>, hidden: number): string => `${shown.join(", ")}${hidden > 0 ? ` và ${hidden} người khác` : ""}`
    const markup = group(5, { describe })
    assert.ok(markup.includes('role="group"'))
    assert.ok(markup.includes('aria-label="Nguyễn Văn An, Trần Bình, Đỗ Thị Hoa và 2 người khác"'), markup.slice(0, 400))
    assert.ok(group(5).includes('aria-label="Nhóm"'), "label names the group when there is no describe")
    const source = read("core/composite/AvatarGroup/index.tsx")
    assert.ok(!/[ăâđêôơưĂÂĐÊÔƠƯàáảãạ]/u.test(source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "no Vietnamese literal in the component code")
})

test("group: the row follows the same overflow rule: max - 1 members, then +N for the rest; all show when they fit", () => {
    const rowOf = (count: number, max?: number) => render(createElement(AvatarGroup, { label: "Nhóm", items: people(count), ...(max === undefined ? {} : { max }), overflowLabel: (hidden: number) => `${hidden} người khác` }))
    const six = rowOf(6, 3)
    assert.deepEqual(letters(six), ["NA", "TB", "+4"], "max 3 is two members and +4")
    assert.ok(six.includes('aria-label="4 người khác"'))
    assert.deepEqual(letters(rowOf(5)), ["NA", "TB", "ĐH", "+2"], "the default max is 4: three members and +2")
    assert.deepEqual(letters(rowOf(4)), ["NA", "TB", "ĐH", "LĐ"], "four fit in max 4, no +N")
    assert.deepEqual(letters(rowOf(7, 6)), ["NA", "TB", "ĐH", "LĐ", "PM", "+2"], "seven providers, max 6: five and +2")
    assert.equal(avatarGroupSlots(7, 6).hidden, 2)
    assert.deepEqual(avatarGroupSlots(3, 0), { shown: 1, hidden: 2 }, "max is at least 2 slots")
})

test("group: the cluster never exceeds its 2 by 2 whatever `max` says, and the row keeps the +N of what it hides", () => {
    for (const count of [5, 6, 9]) {
        const grid = group(count, { max: 12 })
        assert.equal(cells(grid), "4", `${count} items`)
        assert.equal(letters(grid).slice(-1)[0], String(count), `${count} items: the headcount`)
        const row = render(createElement(AvatarGroup, { label: "Nhóm", items: people(count), overflowLabel: (hidden: number) => `${hidden} người khác` }))
        assert.equal(letters(row).slice(-1)[0], `+${count - 3}`, `${count} items: the row hides the rest`)
    }
    assert.deepEqual(avatarGroupTiles(5, 3).map((tile) => (tile.kind === "member" ? "m" : `+${tile.count}`)), ["m", "m", "+3"])
})

const MailGlyph = () => createElement("svg", { "data-glyph": "mail", viewBox: "0 0 24 24" })
const providers = [
    { id: "zalo", name: "Zalo", mark: { logo: createElement(MailGlyph), color: "rgb(0 104 255)", ink: "rgb(255 255 255)" } },
    { id: "mail", name: "Email", mark: { logo: createElement(MailGlyph) } },
    { id: "fb", name: "Facebook", mark: { logo: createElement(MailGlyph), tone: "strong" as const }, tone: "danger" as const },
    { id: "an", name: "Nguyễn Văn An" },
]
const none = (): string => ""

test("mark: the app's logo on a round plate, a Grammar token by default, a brand colour passed in; the name names it; the person keeps initials", () => {
    const html = render(createElement(Avatar, { name: "Zalo", mark: providers[0]?.mark ?? {} }))
    assert.ok(html.includes('data-glyph="mail"') && html.includes("starci-core-avatar-mark-icon"))
    assert.ok(html.includes('data-grammar-avatar-mark="brand"') && html.includes("--starci-avatar-mark-plate:rgb(0 104 255)") && html.includes("--starci-avatar-mark-ink:rgb(255 255 255)"), html)
    assert.ok(html.includes('role="img"') && html.includes('aria-label="Zalo"'))
    assert.equal(images(html).length, 0, "a mark draws no initials image")
    const token = render(createElement(Avatar, { name: "Email", mark: { logo: createElement(MailGlyph) } }))
    assert.ok(token.includes('data-grammar-avatar-mark="solid"') && !token.includes("--starci-avatar-mark-plate"), "no brand colour: the token plate")
    const css = read("common/components-navigation.css")
    assert.match(css, /\[data-grammar-avatar-mark\] \{[\s\S]*?--starci-avatar-mark-plate: var\(--accent\);[\s\S]*?--starci-avatar-mark-ink: var\(--accent-foreground\);/)
    assert.match(read("common/ramps.css"), /--grammar-avatar-mark-ratio: 0\.5;/)
})

test("group: people and marks share one group, in both layouts, each named once, the +N the same", () => {
    const row = render(createElement(AvatarGroup, { label: "Kênh", items: providers, overflowLabel: none }))
    assert.equal((row.match(/data-grammar-avatar-mark=/g) ?? []).length, 3, "three marks and the person, four fit")
    assert.deepEqual(images(row).map(lettersOf), ["NA"], "the person keeps initials")
    const more = render(createElement(AvatarGroup, { label: "Kênh", items: [...providers, { id: "x", name: "Telegram", mark: { logo: createElement(MailGlyph) } }], overflowLabel: (hidden: number) => `${hidden} khác` }))
    assert.equal((more.match(/data-grammar-avatar-mark=/g) ?? []).length, 3)
    assert.deepEqual(letters(more).filter((text) => text.startsWith("+")), ["+2"], "three marks shown, the person and the fifth are +2")
    const grid = render(createElement(AvatarGroup, { label: "Kênh", layout: "grid", items: providers, overflowLabel: none }))
    assert.equal(cells(grid), "4")
    assert.equal((grid.match(/data-grammar-avatar-mark=/g) ?? []).length, 3)
    assert.ok(grid.includes('aria-label="Zalo"') && grid.includes('aria-label="Facebook"'), "four items: three drawn, the fourth is in the count cell")
})

test("danger: tone=danger rings an item in the danger token, drawn as an outline in its own box, never an invisible area", () => {
    const row = render(createElement(AvatarGroup, { label: "Kênh", items: providers, overflowLabel: none }))
    assert.equal((row.match(/data-grammar-avatar-tone="danger"/g) ?? []).length, 1)
    const grid = render(createElement(AvatarGroup, { label: "Kênh", layout: "grid", items: providers, overflowLabel: none }))
    assert.equal((grid.match(/data-grammar-avatar-tone="danger"/g) ?? []).length, 1)
    const css = read("common/components-navigation.css") + read("common/components-avatar-group.css")
    assert.match(css, /\.starci-core-avatar\[data-grammar-avatar-tone="danger"\] \{[\s\S]*?outline: var\(--grammar-ring-width\) solid var\(--danger\);/)
    assert.match(css, /\.starci-core-avatar-group-member\[data-grammar-avatar-tone="danger"\] \{[\s\S]*?outline: var\(--grammar-ring-width\) solid var\(--danger\);/)
    assert.ok(!/data-grammar-avatar-tone="danger"\] \{[^}]*(padding|margin|inset:)/.test(css), "the ring takes no layout or hit area")
    assert.ok(render(createElement(Avatar, { name: "An", tone: "danger" })).includes("data-grammar-avatar-hue="), "the danger avatar keeps its generated plate")
})

test("group: the group shows alone (no names beside it) and controls a member list of EVERY item; the list is closed until hover, focus or a tap", () => {
    const html = render(createElement(AvatarGroup, { label: "Nhóm", items: people(6), overflowLabel: none }))
    assert.ok(/role="group"[^>]*aria-label="Nhóm"/.test(html), "the accessible group label stays")
    assert.ok(/aria-expanded="false"/.test(html) && /aria-controls="[^"]+"/.test(html) && /tabindex="0"/.test(html), "the group is focusable and controls its list")
    assert.ok(!html.includes("title="), "no title tooltip: the member list replaced it")
    assert.ok(!html.includes("data-grammar-avatar-members"), "the list is not rendered while closed")
    for (const person of people(6)) assert.ok(!html.includes(`>${person.name}<`), `no name printed as text: ${person.name}`)
    const source = read("core/composite/AvatarGroup/index.tsx")
    assert.ok(!/memberNames/.test(source), "memberNames is deleted")
    assert.ok(/isNonModal/.test(source) && /onPointerEnter/.test(source) && /onFocus/.test(source) && /onPointerUp/.test(source), "hover, focus and tap open it; it takes no focus")
    const whole = render(createElement(AvatarGroup, { label: "Nhóm", items: people(3), overflowLabel: none, hasMemberList: false }))
    assert.ok(!/tabindex|aria-expanded/.test(whole), "inside a whole-card link the group is not a control")
})

test("an image overrides the initials: the image part is drawn and a custom fallback replaces the letters only while it loads", () => {
    const withImage = render(createElement(Avatar, { name: "Nguyễn Văn An", src: "https://example.test/a.png", fallback: createElement("b", null, "…") }))
    assert.ok(withImage.includes("<b>…</b>"))
    assert.equal(images(withImage).length, 0)
    const plain = render(createElement(Avatar, { name: "Nguyễn Văn An", src: "https://example.test/a.png" }))
    assert.deepEqual(images(plain).map(lettersOf), ["NA"], "the initials stay under the image while it loads or fails")
})

test("DiceBear Initials, local only: no network, no dicebear.com URL in the sources or in any image, the two pinned packages and no other", () => {
    const sources = ["core/leaf/Avatar/index.tsx", "core/leaf/Avatar/identity.ts", "core/leaf/Avatar/dicebear.ts", "core/composite/AvatarGroup/index.tsx"]
    for (const path of sources) {
        const code = read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
        assert.ok(!/dicebear\.com/i.test(code), `${path}: a dicebear.com URL`)
        assert.ok(!/\b(fetch|XMLHttpRequest|sendBeacon)\b|https?:\/\//.test(code), `${path}: a network call or URL`)
        assert.ok(!/sprout/i.test(code), `${path}: the sprout style`)
    }
    const dicebear = read("core/leaf/Avatar/dicebear.ts")
    assert.deepEqual([...dicebear.matchAll(/from "(@dicebear\/[^"]+)"/g)].map((match) => match[1]), ["@dicebear/core", "@dicebear/styles/initials.json"])
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { dependencies: Record<string, string> }
    assert.deepEqual(Object.entries(manifest.dependencies).filter(([name]) => name.startsWith("@dicebear/")).sort(), [["@dicebear/core", "10.4.0"], ["@dicebear/styles", "10.4.0"]])
    for (const markup of [render(createElement(Avatar, { name: "Lan", kind: "agent" })), group(5)]) {
        assert.ok(images(markup).length > 0)
        assert.ok(!/dicebear\.com/i.test(decodeURIComponent(markup)), "no dicebear.com in the markup")
        for (const svg of images(markup)) assert.ok(!/dicebear\.com|<metadata|<!--/i.test(svg))
    }
})

test("sizes: two only (owner: \"40 và 24 thôi, không có 32\"): sm draws 24px and md 40px for an Avatar, both AvatarGroup layouts, a mark, the +N and a loading avatar", () => {
    const ramps = read("common/ramps.css")
    assert.match(ramps, /--grammar-avatar-md-size: 2\.5rem;/)
    assert.match(ramps, /--grammar-avatar-sm-size: 1\.5rem;/)
    const css = read("common/styles.css")
    for (const [size, token] of [["md", "md"], ["sm", "sm"]] as const) {
        const v = `var\\(--grammar-avatar-${token}-size\\);`
        const rule = new RegExp(`\\.starci-core-avatar\\[data-grammar-avatar-size="${size}"\\] \\{[^}]*--avatar-size: ${v}[^}]*inline-size: ${v}[^}]*block-size: ${v}`)
        assert.match(css, rule, size)
    }
    assert.ok(!/data-grammar-avatar-size="(lg|control)"/.test(css + read("common/components-navigation.css")), "no lg or control size is drawn")
    const sized = (node: Parameters<typeof render>[0], size: "sm" | "md"): number => (render(node).match(new RegExp(`class="[^"]*starci-core-avatar[^"]*"[^>]*data-grammar-avatar-size="${size}"|data-grammar-avatar-size="${size}"[^>]*class="[^"]*starci-core-avatar`, "g")) ?? []).length
    for (const size of ["sm", "md"] as const) {
        assert.ok(sized(createElement(Avatar, { name: "An", size }), size) >= 1, `Avatar ${size}`)
        assert.ok(sized(createElement(Avatar, { name: "Zalo", size, mark: { logo: createElement("i") } }), size) >= 1, `mark ${size}`)
        assert.ok(sized(createElement(Avatar, { name: "An", size, isLoading: true }), size) >= 1, `loading ${size}`)
        assert.ok(sized(createElement(AvatarGroup, { label: "Nhóm", items: people(6), size, overflowLabel: none }), size) >= 4, `row ${size}: three members and +N`)
        assert.ok(sized(createElement(AvatarGroup, { label: "Nhóm", layout: "grid", items: people(6), size, overflowLabel: none }), size) >= 1, `grid ${size}`)
    }
    const source = read("core/leaf/Avatar/index.tsx")
    assert.match(source, /export type AvatarSize = "sm" \| "md"\r?\n/)
    assert.ok(!/fallbackMark/.test(source + read("core/leaf/AvatarButton/index.tsx")), "fallbackMark is deleted")
    assert.match(read("common/components-overlays.css"), /\.starci-core-skeleton\[data-shape="circle"\]\[data-size="sm"\] \{\s*width: var\(--grammar-avatar-sm-size\);/, "the loading circle is 24 too")
})

test("no AI pill: an agent's avatar is initials only, and the pill's markup, CSS and tokens are gone", () => {
    for (const size of ["sm", "md"] as const) {
        const agent = render(createElement(Avatar, { name: "Claude", kind: "agent", size }))
        assert.ok(!/data-grammar-avatar-ai|ai-badge|ai-glyph|ai-text|agent-anchor|agent-badge/.test(agent), size)
        assert.ok(agent.includes('aria-label="Claude (AI)"'), "the agent is still named once, by the avatar")
        assert.equal(images(agent).length, 1)
    }
    assert.ok(!/data-grammar-avatar-ai|ai-badge/.test(group(4, { items: [...people(3), { id: "bot", name: "Claude", kind: "agent" }] })))
    const sheets = ["common/ramps.css", "common/components-navigation.css", "common/components-avatar-group.css", "common/styles.css"].map(read).join("\n")
    assert.ok(!/avatar-ai|avatar-agent-anchor|ai-badge|ai-glyph|-hang/.test(sheets), "no pill rule or token in any sheet")
    for (const path of ["core/leaf/Avatar/index.tsx", "core/composite/AvatarGroup/index.tsx"]) assert.ok(!/Sparkles|AvatarAgentBadge|data-grammar-avatar-ai/.test(read(path)), path)
})

const chipAfter = (markup: string, name: string): boolean => new RegExp(`${name}[^]*?data-component="Badge"[^]*?>AI<`).test(markup)
const chipCount = (markup: string): number => (markup.match(/data-component="AgentName"/g) ?? []).length

test("AgentName: the name, then a neutral sm Chip with the app's word (AI by default), and nothing without isAgent", () => {
    const on = render(createElement(AgentName, { isAgent: true, name: "Sales AI" }))
    assert.ok(chipAfter(on, "Sales AI") && on.includes('data-tone="neutral"') && on.includes("starci-core-agent-name"), on)
    assert.ok(render(createElement(AgentName, { isAgent: true, agentLabel: "Bot", name: "Sales" })).includes(">Bot<"))
    assert.equal(render(createElement(AgentName, { name: "Lan" })), "Lan")
    assert.match(read("common/components-navigation.css"), /\.starci-core-agent-name \{[\s\S]*?display: inline-flex;[\s\S]*?gap: var\(--grammar-inline-gap\);/)
})

test("AgentName slots: ListRow title, Card head label, MessageBubble sender and the members list each draw the Chip after the name when isAgent is set, not otherwise", () => {
    const row = (extra: Record<string, unknown>) => render(createElement(ListRow, { row: { id: "r1", title: "Sales AI", ...extra } }))
    assert.ok(chipAfter(row({ isAgent: true }), "Sales AI"))
    assert.equal(chipCount(row({})), 0)
    assert.equal(chipCount(row({ isAgent: false })), 0)

    const card = (extra: Record<string, unknown>) => render(createElement(SurfaceCard, { label: "Sales AI", ...extra, children: "x" } as never))
    assert.ok(chipAfter(card({ isAgent: true }), "Sales AI"))
    assert.equal(chipCount(card({})), 0)

    const bubble = (extra: Record<string, unknown>) => render(createElement(MessageBubble, { author: "Sales AI", body: "Hi", ...extra }))
    assert.ok(chipAfter(bubble({ isAgent: true }), "Sales AI"))
    assert.equal(chipCount(bubble({})), 0)

    const members = (extra: Record<string, unknown>) => render(createElement(ListBox, { label: "Thành viên", items: [{ id: "m1", label: "Sales AI", ...extra }, { id: "m2", label: "Lan Anh" }] }))
    assert.ok(chipAfter(members({ isAgent: true }), "Sales AI"))
    assert.equal(chipCount(members({ isAgent: true })), 1, "only the agent's row")
    assert.equal(chipCount(members({})), 0)
})

test("AgentName: the Chip is Grammar's Badge as shipped (default tone, sm, no icon); no avatar pill markup is left anywhere in the sources", () => {
    const source = read("core/leaf/AgentName/index.tsx").replace(/\/\*[\s\S]*?\*\//g, "")
    assert.ok(/<Badge>\{agentLabel\}<\/Badge>/.test(source), "no tone, no startContent: the Badge defaults")
    assert.ok(!/ai-badge|avatar-ai/.test(["core/leaf/Avatar/index.tsx", "core/composite/AvatarGroup/index.tsx", "core/composite/MessageBubble/index.tsx", "core/composite/ListRow/index.tsx"].map(read).join("")))
})

test("provider marks show the app's logo, never initials: a node or an icon source; no logo is the generic channel glyph", () => {
    const node = render(createElement(Avatar, { name: "Zalo", mark: { logo: createElement(MailGlyph) } }))
    assert.match(node, /data-grammar-avatar-logo="app"[^>]*><svg data-glyph="mail"/)
    const source = render(createElement(Avatar, { name: "TikTok", mark: { logo: MailGlyph } }))
    assert.match(source, /data-grammar-avatar-logo="app"[^>]*><svg data-glyph="mail"/, "an icon source is drawn as the glyph")
    const generic = render(createElement(Avatar, { name: "Zalo", mark: {} }))
    assert.match(generic, /data-grammar-avatar-logo="generic"[^>]*><svg/)
    for (const html of [node, source, generic]) {
        assert.equal(images(html).length, 0, "no initials image")
        assert.doesNotMatch(html, /starci-core-avatar-letters|>ZA<|>TI</u, "never initials")
    }
    const row = render(createElement(AvatarGroup, { label: "Kênh", items: providers.slice(0, 3), overflowLabel: none }))
    assert.equal((row.match(/data-grammar-avatar-logo="app"/g) ?? []).length, 3)
    assert.equal((row.match(/data-grammar-avatar-tone="danger"/g) ?? []).length, 1, "the broken account keeps its danger ring")
})

test("the +N mark is the neutral muted pair at both sizes (owner: \"+2 màu muted chớ\"): the default plate and the muted ink, never hashed or accent", () => {
    for (const size of ["sm", "md"] as const) {
        for (const layout of ["row", "grid"] as const) {
            const html = render(createElement(AvatarGroup, { label: "Nhóm", items: people(7), size, layout, overflowLabel: (hidden: number) => `${hidden} khác` }))
            // The row reads "+N" (the hidden ones); the cluster's cell reads the whole headcount, no plus (Zalo).
            const overflow = (layout === "row" ? /<span[^>]*data-grammar-avatar-overflow-mark="muted"[^>]*>\+\d+<\/span>/u : /<span[^>]*data-grammar-avatar-overflow-mark="muted"[^>]*>\d+<\/span>/u).exec(html)?.[0]
            assert.ok(overflow !== undefined, `${size} ${layout}: one muted count`)
            assert.doesNotMatch(overflow, /style=|data-grammar-avatar-hue|src=/u, `${size} ${layout}: no generated colour`)
            assert.doesNotMatch(html, /data:image\/svg\+xml;utf8,[^"]*%2B\d/u, `${size} ${layout}: no hashed +N image`)
        }
    }
    const rule = /\.starci-core-avatar-overflow \{([^}]*)\}/u.exec(read("common/components-avatar-group.css"))?.[1] ?? ""
    assert.match(rule, /background: var\(--default\);/u)
    assert.match(rule, /color: var\(--muted\);/u)
    assert.doesNotMatch(rule, /accent|hue/u)
})

test("round: every circle avatar is a square box clipped by a 50% radius, at both sizes, never squeezed or stretched (owner 2026-11-26)", () => {
    const css = read("common/components-navigation.css")
    const rule = /\.starci-core-avatar:is\(\[data-grammar-avatar-shape="circle"\], :not\(\[data-grammar-avatar-shape\]\)\) \{([^}]*)\}/u.exec(css)?.[1] ?? ""
    assert.match(rule, /aspect-ratio: 1 \/ 1;/u)
    assert.match(rule, /border-radius: var\(--grammar-radius-round\);/u)
    assert.match(rule, /overflow: hidden;/u)
    assert.match(rule, /min-inline-size: var\(--avatar-size\);/u)
    assert.equal(/--grammar-radius-round: 50%;/u.test(read("common/ramps.css")), true)
    for (const size of ["sm", "md"] as const) {
        const html = render(createElement(Avatar, { name: "Lễ Tân", size }))
        assert.ok(html.includes('data-grammar-avatar-shape="circle"') && html.includes(`data-grammar-avatar-size="${size}"`), size)
    }
})

test("channel: a customer's avatar carries a small channel badge in its corner, outside the avatar's round clip, named by the channel", () => {
    const html = render(createElement(Avatar, { name: "Nguyễn Văn An", channel: "messenger" }))
    assert.ok(html.includes("starci-core-avatar-badged") && html.includes('data-grammar-avatar-channel="messenger"'))
    assert.ok(html.indexOf("starci-core-avatar-channel") > html.indexOf("starci-core-avatar-initials"), "the badge follows the avatar, a sibling and not inside it")
    assert.ok(html.includes('aria-label="Messenger"'), "the brand's name")
    assert.match(read("common/components-navigation.css"), /\[data-grammar-avatar-channel="messenger"\] \{ --starci-avatar-channel-ink: var\(--grammar-channel-messenger\); \}/u, "its colour is a token chosen by the channel")
    assert.match(read("common/ramps.css"), /--grammar-channel-messenger: #0866ff;/u)
    assert.ok(html.includes('role="img"') && html.includes('d="'), "a logo path, named")
    assert.ok(render(createElement(Avatar, { name: "An", channel: "zalo", channelLabel: "Tin nhắn Zalo" })).includes('aria-label="Tin nhắn Zalo"'), "the app's own words win")
    assert.ok(render(createElement(Avatar, { name: "An", channel: "email" })).includes('aria-label="Email"'), "email is Grammar's own envelope")
    assert.ok(!render(createElement(Avatar, { name: "An" })).includes("starci-core-avatar-badged"), "no channel, no wrapper")
    for (const channel of Object.keys(CHANNEL_LOGOS) as Array<keyof typeof CHANNEL_LOGOS>) {
        const logo = CHANNEL_LOGOS[channel]
        assert.ok(logo.path.length > 40 && logo.label.length > 0, channel)
    }
    for (const channel of ["messenger", "instagram", "facebook", "zalo", "whatsapp", "telegram", "gmail"] as const) assert.ok(channel in CHANNEL_LOGOS, channel)
    const css = read("common/components-navigation.css")
    const badge = /\.starci-core-avatar-channel \{([^}]*)\}/u.exec(css)?.[1] ?? ""
    assert.match(badge, /border-radius: var\(--grammar-radius-round\);/u)
    assert.match(badge, /aspect-ratio: 1 \/ 1;/u)
})
