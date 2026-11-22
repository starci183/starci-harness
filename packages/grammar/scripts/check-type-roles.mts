import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Contract check (the final type scale, owner 2026-11-09): 14 for all UI text, 12 for small names, no 13 (`--grammar-text-sm` is
 * 14), display sizes 18 (page title) and 20 (figure value) only. Before it, the type roles of 0.28: The rules that draw a role are pinned to its tokens, so a
 * later edit cannot drift a tab, a body Text or a table cell off its step: every tab sm 13; Text md 14 / sm 13 / xs 12, `isStrong` 500;
 * page title xl 18 / 500; card title lg 16 / 500; row primary md 14 / 500, its description sm 13, its meta xs 12; table header xs 12,
 * cell md 14, row header 500; a Link inherits the size around it; a Sublabel is 12 / 500 muted; the page header band's content takes the page measure like the body (one start edge, MEASURE-8, 0.41.0); the page body and the workspace main pane are capped at 80rem and centred.
 */
const common = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "common")
const sheets = ["styles.css", "components-navigation.css", "components-forms.css"].map((name) => ({ name, text: readFileSync(resolve(common, name), "utf8") }))

/** Each pin: the exact selector of one rule and the declarations it must hold. */
const PINS: readonly { readonly selector: string; readonly holds: readonly string[] }[] = [
    { selector: ".starci-core-tabs .tabs__tab", holds: ["font-size: var(--grammar-text-sm) !important", "line-height: var(--grammar-leading-sm) !important"] },
    { selector: ".starci-core-text", holds: ["font-size: var(--grammar-text-md)", "font-weight: var(--grammar-weight-regular)"] },
    { selector: '.starci-core-text[data-strong="true"]', holds: ["font-weight: var(--grammar-weight-medium)"] },
    { selector: ".starci-core-section-title", holds: ["font-size: var(--grammar-text-xl)", "font-weight: var(--grammar-weight-medium)"] },
    { selector: ":is(h2, h3, h4, h5, h6).starci-core-section-title", holds: ["font-size: var(--grammar-type-title-section-size)", "font-weight: var(--grammar-type-title-section-weight)", "line-height: var(--grammar-type-title-section-line)"] },
    { selector: ".starci-core-label", holds: ["font-size: var(--grammar-type-title-section-size)", "font-weight: var(--grammar-type-title-section-weight)"] },
    { selector: ".starci-core-list-row-name", holds: ["font-size: var(--grammar-type-label-item-size)", "font-weight: var(--grammar-type-label-item-weight)", "line-height: var(--grammar-type-label-item-line)"] },
    { selector: ".starci-core-list-row-description", holds: ["font-size: var(--grammar-text-sm)"] },
    { selector: ".starci-core-list-row-meta", holds: ["font-size: var(--grammar-type-caption-size)", "line-height: var(--grammar-type-caption-line)"] },
    { selector: ".starci-core-data-table .starci-core-data-table-column", holds: ["font-size: var(--grammar-type-label-field-size)", "font-weight: var(--grammar-type-label-field-weight)", "color: var(--muted)"] },
    { selector: ".starci-core-field-label", holds: ["font-size: var(--grammar-type-label-field-size)", "font-weight: var(--grammar-type-label-field-weight)", "color: var(--muted)"] },
    { selector: ".starci-core-field-description", holds: ["font-size: var(--grammar-type-caption-size)", "color: var(--muted)"] },
    { selector: ".starci-core-description-stat-term", holds: ["font-size: var(--grammar-type-label-group-size)", "font-weight: var(--grammar-type-label-group-weight)", "color: var(--muted)"] },
    { selector: ".starci-core-description-figure", holds: ["font-size: var(--grammar-type-figure-size)", "font-weight: var(--grammar-type-figure-weight)", "line-height: var(--grammar-type-figure-line)"] },
    { selector: '[data-component="Badge"][data-loading]', holds: ["font-size: var(--grammar-type-badge-size)", "font-weight: var(--grammar-type-badge-weight)"] },
    { selector: ".starci-core-data-table .starci-core-data-table-cell", holds: ["font-size: var(--grammar-text-md)", "font-weight: var(--grammar-weight-regular)"] },
    { selector: '.starci-core-data-table .starci-core-data-table-cell[data-grammar-table-row-header="true"]', holds: ["font-weight: var(--grammar-weight-medium)"] },
    { selector: ".starci-core-link", holds: ["font-size: inherit !important", "line-height: inherit !important"] },
    { selector: '.starci-core-page[data-grammar-page-layout="workspace"] .starci-core-pane[data-grammar-pane-content="cards"] > .starci-core-pane-stack', holds: ["max-inline-size: var(--grammar-content-max)", "margin-inline: auto"] },
    { selector: ".starci-core-sublabel", holds: ["font-size: var(--grammar-text-xs)", "font-weight: var(--grammar-weight-medium)", "color: var(--muted)"] },
    { selector: ".starci-core-page-container", holds: ["margin-inline: auto"] },
    { selector: ".starci-core-surface", holds: ["border: 1px solid var(--border)"] },
    { selector: ".starci-core-section-list", holds: ["--starci-core-row-inset: var(--grammar-row-gap) var(--grammar-row-inset-inline)"] },
    { selector: ".starci-core-data-table", holds: ["border: 0", "border-radius: 0", "background: transparent", "box-shadow: none"] },
    { selector: ".starci-core-data-table .table__column", holds: ["border-block-end: 1px solid var(--border)"] },
    { selector: ".starci-core-data-table .table__row .table__cell", holds: ["border-block-end: 1px solid var(--separator)"] },
    { selector: '.starci-core-data-table-row[data-grammar-selected="true"]', holds: ["background: var(--default)"] },
    { selector: '.starci-core-data-table-row[data-grammar-selected="true"] > :first-child', holds: ["box-shadow: inset var(--grammar-ring-width) 0 0 0 var(--accent)"] },
    { selector: '.starci-core-description-list[data-grammar-description-layout="stat-strip"][data-grammar-figures-placement="ribbon"]', holds: ["border-block: 1px solid var(--border)", "border-inline: 0", "background: transparent"] },
    { selector: ".starci-core-section-caption", holds: ["font-size: var(--grammar-text-xs)"] },
    { selector: ".starci-core-section-count[data-grammar-section-count]", holds: ["font-size: var(--grammar-text-xs)", "border-radius: var(--grammar-radius-pill)"] },
    { selector: ".starci-core-data-table-footer", holds: ["font-size: var(--grammar-text-xs)"] },
]

/** The bodies of every rule whose selector list is exactly `selector`. */
const bodiesOf = (selector: string): string[] => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const pattern = new RegExp(`(?:^|[}\\n])\\s*${escaped}\\s*\\{([^}]*)\\}`, "g")
    return sheets.flatMap(({ text }) => [...text.matchAll(pattern)].map((match) => match[1] ?? ""))
}

const problems: string[] = []
const ramps = readFileSync(resolve(common, "ramps.css"), "utf8")
const all = sheets.map(({ text }) => text).join("\n")
if (!/--grammar-text-sm:\s*0\.875rem;/.test(ramps)) problems.push("ramps.css: --grammar-text-sm must be 0.875rem (no 13 anywhere)")
/* 0.54.0: 13 is the label.field role alone (owner 2026-11-21); no other rule or token is 13. */
if (/0\.8125rem/.test(all + ramps.replace("--grammar-type-label-field-size: 0.8125rem;", ""))) problems.push("a 13px size (0.8125rem) outside the label.field role")
/* THE TYPE ROLES (0.54.0): ten roles, three tokens each, one public class each reading them; weights 400 and 500 only. */
const ROLES: readonly (readonly [string, string, string, "regular" | "medium"])[] = [
    ["figure", "1.5rem", "2rem", "medium"], ["title-page", "1.375rem", "1.75rem", "medium"], ["title-section", "1rem", "1.5rem", "medium"],
    ["label-item", "0.875rem", "1.25rem", "medium"], ["body", "0.875rem", "1.375rem", "regular"], ["label-field", "0.8125rem", "1.125rem", "medium"],
    ["label-group", "0.75rem", "1rem", "medium"], ["caption", "0.75rem", "1rem", "regular"], ["badge", "0.75rem", "1rem", "medium"], ["code", "0.75rem", "1.125rem", "regular"],
]
for (const [role, size, line, weight] of ROLES) {
    for (const [part, value] of [["size", size], ["line", line], ["weight", `var(--grammar-weight-${weight})`]] as const) {
        if (!ramps.includes(`--grammar-type-${role}-${part}: ${value};`)) problems.push(`ramps.css: --grammar-type-${role}-${part} must be ${value} (the owner's type roles, 0.54.0)`)
    }
    const reads = (part: string): string => `${part}: var(--grammar-type-${role}-${part === "font-size" ? "size" : part === "line-height" ? "line" : "weight"});`
    const body = /\{([^}]*)\}/.exec(all.slice(all.indexOf(`.starci-type-${role} {`)))?.[1] ?? ""
    if (!all.includes(`.starci-type-${role} {`) || !["font-size", "line-height", "font-weight"].every((part) => body.includes(reads(part)))) problems.push(`styles.css: .starci-type-${role} must read its three role tokens`)
}
/*
 * THE SITE GROUP (0.55.0, owner 2026-11-21, "3. THÊM NHÓM"): five roles of the public site, each with its 390 value and its steps from 48rem and
 * 64rem in ramps.css; the display roles track -0.02em; every line holds the 1.33x floor for Vietnamese diacritics.
 */
const SITE_ROLES: readonly { readonly role: string; readonly weight: "regular" | "medium"; readonly tracking: boolean; readonly steps: readonly (readonly [string, string, string])[] }[] = [
    { role: "display-hero", weight: "medium", tracking: true, steps: [["base", "2.25rem", "3rem"], ["48rem", "2.5rem", "3.375rem"], ["64rem", "3rem", "4rem"]] },
    { role: "display-section", weight: "medium", tracking: true, steps: [["base", "1.75rem", "2.375rem"], ["64rem", "2rem", "2.75rem"]] },
    { role: "display-figure", weight: "medium", tracking: true, steps: [["base", "2.25rem", "3rem"], ["48rem", "3rem", "4rem"], ["64rem", "3.5rem", "4.75rem"]] },
    { role: "lead", weight: "regular", tracking: false, steps: [["base", "1rem", "1.625rem"], ["64rem", "1.125rem", "1.75rem"]] },
    { role: "title-card", weight: "medium", tracking: false, steps: [["base", "1.125rem", "1.75rem"]] },
]
/** The body of the `.grammar-common-root` rule inside `@media (min-width: <at>)` of ramps.css, or the base root rule. */
const rampsAt = (at: string): string => {
    if (at === "base") return /\.grammar-common-root \{([^}]*)\}/.exec(ramps)?.[1] ?? ""
    return new RegExp(`@media \\(min-width: ${at}\\) \\{\\s*\\.grammar-common-root \\{([^}]*)\\}`).exec(ramps)?.[1] ?? ""
}
for (const { role, weight, tracking, steps } of SITE_ROLES) {
    for (const [at, size, line] of steps) {
        const body = rampsAt(at)
        for (const [part, value] of [["size", size], ["line", line]] as const) {
            if (!body.includes(`--grammar-type-${role}-${part}: ${value};`)) problems.push(`ramps.css: --grammar-type-${role}-${part} must be ${value} at ${at} (the site group, 0.55.0)`)
        }
        if (Number.parseFloat(line) / Number.parseFloat(size) < 1.33) problems.push(`the site group: ${role} ${size} / ${line} is under the 1.33x line height`)
    }
    for (const [at] of [["48rem"], ["64rem"]] as const) {
        if (!steps.some(([step]) => step === at) && rampsAt(at).includes(`--grammar-type-${role}-`)) problems.push(`ramps.css: ${role} takes no step at ${at}`)
    }
    if (!ramps.includes(`--grammar-type-${role}-weight: var(--grammar-weight-${weight});`)) problems.push(`ramps.css: --grammar-type-${role}-weight must be the ${weight} weight`)
    if (tracking !== ramps.includes(`--grammar-type-${role}-tracking: -0.02em;`)) problems.push(`ramps.css: ${role} ${tracking ? "must track -0.02em" : "takes no tracking"}`)
    const body = /\{([^}]*)\}/.exec(all.slice(all.indexOf(`.starci-type-${role} {`)))?.[1] ?? ""
    const parts = ["size", "line", "weight", ...(tracking ? ["tracking"] : [])]
    const property: Readonly<Record<string, string>> = { size: "font-size", line: "line-height", weight: "font-weight", tracking: "letter-spacing" }
    if (!all.includes(`.starci-type-${role} {`) || !parts.every((part) => body.includes(`${property[part] ?? ""}: var(--grammar-type-${role}-${part});`)) || /(^|;)\s*color:/.test(body)) problems.push(`styles.css: .starci-type-${role} must read its role tokens and set no colour`)
}
for (const match of all.matchAll(/\.starci-core-tabs[^{]*\.tabs__tab[^{]*\{[^}]*font-size:\s*var\(--grammar-text-([a-z0-9]+)\)/g)) {
    if (match[1] !== "sm" && match[1] !== "md") problems.push(`a tab rule sets --grammar-text-${match[1]}; every tab is 14`)
}
/* THE RESPONSIVE LAW: the page inset steps 12 on a phone (the scale has no 16), 24 from 48rem and 32 from 80rem. */
if (!/--grammar-page-inset:\s*0.75rem;/.test(all)) problems.push("styles.css: the phone page inset must be 0.75rem (12)")
if (!/@media \(min-width: 48rem\) \{\s*\.grammar-common-root \{\s*--grammar-page-inset: 1\.5rem;/.test(all)) problems.push("styles.css: the tablet page inset must be 1.5rem (24) from 48rem")
if (!/@media \(min-width: 80rem\) \{\s*\.grammar-common-root \{\s*--grammar-page-inset: 2rem;/.test(all)) problems.push("styles.css: the desktop page inset must be 2rem (32) from 80rem")
/* THE FIGURES RIBBON (five cells): 2 columns on a phone, 3 from 30rem, one row from 52rem of the strip's own width; the label clamps to two lines. */
for (const needle of ['[data-grammar-figure-count="5"][data-grammar-figures-placement] .starci-core-description-pair { flex-basis: 50%; }', "@container starci-core-description-strip (min-width: 30rem)", "flex-basis: calc(100% / 3)", "@container starci-core-description-strip (min-width: 52rem)", "-webkit-line-clamp: 2"]) {
    if (!all.includes(needle)) problems.push(`components-navigation.css: the five-figure ribbon lost \`${needle}\``)
}
for (const pin of PINS) {
    const bodies = bodiesOf(pin.selector)
    if (bodies.length === 0) {
        problems.push(`${pin.selector}: no rule found (the type role lost its owner)`)
        continue
    }
    const declared = bodies.join(";").replace(/\s+/g, " ")
    for (const hold of pin.holds) {
        if (!declared.includes(hold)) problems.push(`${pin.selector}: must declare \`${hold}\``)
    }
}
/* BOUNDARY-6: a card is one object with a 1px --border edge and no shadow on every ground; no Common rule gives a card or a table a shadow. */
for (const match of all.matchAll(/([^{}]*)\{([^}]*)\}/g)) {
    const selector = (match[1] ?? "").trim()
    if (/\.starci-core-(surface|data-table)(?![-\w])/.test(selector.split(",").pop() ?? "") && /box-shadow:\s*var\(--surface-shadow\)/.test(match[2] ?? "")) problems.push(`${selector}: a card or a table casts no shadow (BOUNDARY-6)`)
}
/* ONE LOOK FOR A LIST (0.43.0): a list section is plain rows on its surface; no rule gives it a frame, fill, radius or shadow. */
for (const match of all.matchAll(/([^{}]*\.starci-core-section-list[^{}]*)\{([^}]*)\}/g)) {
    if (/(^|[;\s])(border|border-radius|background|box-shadow)\s*:/.test(match[2] ?? "")) problems.push(`${(match[1] ?? "").trim()}: a list section is flat, no border, radius, fill or shadow (one look, 0.43.0)`)
}
/* ONE START EDGE (MEASURE-8, 0.41.0): the header band's PageContainer keeps the page measure; no rule uncaps or un-centres it. */
if (bodiesOf(".starci-core-page-header .starci-core-page-container").length > 0) problems.push("the page header's content must keep the page measure, capped and centred like the body (MEASURE-8, 0.41.0)")
const tableSource = readFileSync(resolve(common, "..", "core", "branch", "DataTable", "index.tsx"), "utf8")
if (!tableSource.includes('variant="secondary"') || /readonly surface\??:/.test(tableSource) || /data-grammar-table-surface/.test(tableSource + all)) problems.push("a DataTable has one flat look: HeroUI's secondary variant, no `surface` prop and no surface rule")
/* THE BUBBLE SHAPE AND REACTIONS (0.32.0): Messenger grouping with logical corners (RTL mirrors), reactions with transform/opacity motion only. */
for (const [needle, message] of [
    ["--grammar-bubble-radius: 1.125rem", "a lone bubble must be rounded 18"],
    ["--grammar-bubble-tail: 0.25rem", "a touching corner must be 4"],
    ['[data-grammar-bubble-side="incoming"]:is([data-grammar-bubble-group="first"], [data-grammar-bubble-group="middle"]) .starci-core-message-bubble-body { border-end-start-radius', "an incoming run squares the bottom-start corner of first and middle"],
    ['[data-grammar-bubble-side="incoming"]:is([data-grammar-bubble-group="middle"], [data-grammar-bubble-group="last"]) .starci-core-message-bubble-body { border-start-start-radius', "an incoming run squares the top-start corner of middle and last"],
    ['[data-grammar-bubble-side="outgoing"]:is([data-grammar-bubble-group="first"], [data-grammar-bubble-group="middle"]) .starci-core-message-bubble-body { border-end-end-radius', "an outgoing run mirrors it on the end side"],
    ['[data-grammar-bubble-side="outgoing"]:is([data-grammar-bubble-group="middle"], [data-grammar-bubble-group="last"]) .starci-core-message-bubble-body { border-start-end-radius', "an outgoing run mirrors it on the end side"],
    ["border: var(--grammar-border-edge);\n        background: transparent;\n        color: var(--foreground);\n        box-shadow: none;", "an incoming bubble and a MessageCard are one look on every host: the 1px border edge, no fill, no shadow (0.52.0, DNA-COMMON-CHAT-INCOMING-OUTLINE)"],
    ["@keyframes starci-core-reaction-rise", "the reaction burst needs its keyframes"],
    [".starci-core-reaction-burst-layer { display: none; }", "the burst is off under prefers-reduced-motion"],
    [".starci-core-reaction-bar-emoji:hover", "a hovered emoji scales up"],
] as const) {
    if (!all.replace(/\r\n/g, "\n").includes(needle)) problems.push(`${message} (${needle.slice(0, 60)})`)
}
/* ONE LOOK (0.52.0): no host repaints the other party's message (no surface-dependent edge or fill). */
if (/\)\s*\.starci-core-message-bubble:is\(\[data-grammar-bubble-side="incoming"\], \[data-grammar-bubble-content="card"\]\)[^{]*\{/.test(all.replace(/\/\*[\s\S]*?\*\//g, ""))) problems.push("an incoming bubble has one look: no host-dependent rule repaints it (0.52.0)")
const keyframes = all.match(/@keyframes starci-core-reaction-rise\s*\{([\s\S]*?)\n    \}/)?.[1] ?? ""
if (/(?:^|[\s;{])(?:top|left|right|bottom|width|height|margin|inset)[a-z-]*\s*:/.test(keyframes)) problems.push("the reaction burst may animate transform and opacity only")
const reactionSource = readFileSync(resolve(common, "..", "core", "composite", "MessageBubble", "Reactions.tsx"), "utf8")
for (const needle of ['role="toolbar"', "aria-label={labels.toolbar}", "ArrowRight", "ArrowLeft", "prefers-reduced-motion", "labels.pill("]) {
    if (!reactionSource.includes(needle)) problems.push(`Reactions.tsx must keep ${needle} (the toolbar is a labelled group with arrow keys; the pill has an accessible name; the burst honours reduced motion)`)
}
if (problems.length > 0) {
    console.error(problems.join("\n"))
    process.exit(1)
}
console.log(`type scale: ${PINS.length} rules hold their tokens; 14 for UI text, 12 for small names, no 13, every tab 14; cards draw the 1px border edge and no shadow; tables are flat; bubbles group like Messenger; reactions pinned`)
