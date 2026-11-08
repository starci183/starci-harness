import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Contract check (the final type scale, owner 2026-11-09): 14 for all UI text, 12 for small names, no 13 (`--grammar-text-sm` is
 * 14), display sizes 18 (page title) and 20 (figure value) only. Before it, the type roles of 0.28: The rules that draw a role are pinned to its tokens, so a
 * later edit cannot drift a tab, a body Text or a table cell off its step: every tab sm 13; Text md 14 / sm 13 / xs 12, `isStrong` 500;
 * page title xl 18 / 500; card title lg 16 / 500; row primary md 14 / 500, its description sm 13, its meta xs 12; table header xs 12,
 * cell md 14, row header 500; a Link inherits the size around it.
 */
const common = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "common")
const sheets = ["styles.css", "components-navigation.css"].map((name) => ({ name, text: readFileSync(resolve(common, name), "utf8") }))

/** Each pin: the exact selector of one rule and the declarations it must hold. */
const PINS: readonly { readonly selector: string; readonly holds: readonly string[] }[] = [
    { selector: ".starci-core-tabs .tabs__tab", holds: ["font-size: var(--grammar-text-sm) !important", "line-height: var(--grammar-leading-sm) !important"] },
    { selector: ".starci-core-text", holds: ["font-size: var(--grammar-text-md)", "font-weight: var(--grammar-weight-regular)"] },
    { selector: '.starci-core-text[data-size="sm"]', holds: ["font-size: var(--grammar-text-sm)"] },
    { selector: '.starci-core-text[data-size="xs"]', holds: ["font-size: var(--grammar-text-xs)"] },
    { selector: '.starci-core-text[data-strong="true"]', holds: ["font-weight: var(--grammar-weight-medium)"] },
    { selector: ".starci-core-section-title", holds: ["font-size: var(--grammar-text-xl)", "font-weight: var(--grammar-weight-semibold)"] },
    { selector: ":is(h2, h3, h4, h5, h6).starci-core-section-title", holds: ["font-size: var(--grammar-text-md)"] },
    { selector: ".starci-core-label", holds: ["font-size: var(--grammar-text-md)", "font-weight: var(--grammar-weight-semibold)"] },
    { selector: ".starci-core-list-row-name", holds: ["font-size: var(--grammar-text-md)", "font-weight: var(--grammar-weight-medium)"] },
    { selector: ".starci-core-list-row-description", holds: ["font-size: var(--grammar-text-sm)"] },
    { selector: ".starci-core-list-row-meta", holds: ["font-size: var(--grammar-text-xs)"] },
    { selector: ".starci-core-data-table .starci-core-data-table-column", holds: ["font-size: var(--grammar-text-md)"] },
    { selector: ".starci-core-data-table .starci-core-data-table-cell", holds: ["font-size: var(--grammar-text-md)", "font-weight: var(--grammar-weight-regular)"] },
    { selector: '.starci-core-data-table .starci-core-data-table-cell[data-grammar-table-row-header="true"]', holds: ["font-weight: var(--grammar-weight-medium)"] },
    { selector: '.starci-core-link[data-grammar-link-size="inherit"]', holds: ["font-size: inherit !important"] },
    { selector: '.starci-core-surface-zone:not([data-grammar-zone="figures"]) .starci-core-text:not([data-size="figure"])', holds: ["font-size: var(--grammar-text-sm)"] },
    { selector: ".starci-core-section-caption", holds: ["font-size: var(--grammar-text-sm)"] },
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
if (/0\.8125rem/.test(all + ramps)) problems.push("a 13px size (0.8125rem) is back")
for (const match of all.matchAll(/\.starci-core-tabs[^{]*\.tabs__tab[^{]*\{[^}]*font-size:\s*var\(--grammar-text-([a-z0-9]+)\)/g)) {
    if (match[1] !== "sm" && match[1] !== "md") problems.push(`a tab rule sets --grammar-text-${match[1]}; every tab is 14`)
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
if (problems.length > 0) {
    console.error(problems.join("\n"))
    process.exit(1)
}
console.log(`type scale: ${PINS.length} rules hold their tokens; 14 for UI text, 12 for small names, no 13, every tab 14`)
