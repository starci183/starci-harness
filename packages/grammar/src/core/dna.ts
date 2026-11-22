/**
 * Stable visual identity shipped by Core Grammar.
 *
 * This is presentation data, not a registry of UI laws. Product rules remain
 * outside the package; consumers use these values to render the same StarCi
 * family without rebuilding its palette, geometry or motion from memory.
 *
 * Every colour pair the family's CSS combines clears WCAG AA in light and dark, measured
 * through the resolved scope, HeroUI's vendor variables included. `accent` is the
 * brand FILL (white text on it, and the focus ring); where the accent is painted as TEXT - links,
 * the current tab label, the section eyebrow, the soft accent pairing - the family
 * reads `accentText`, which is themed because the violet fill is too dark to read on the dark
 * canvas (3.95:1) and a hair too light on the secondary surface (4.44:1). `accentSoft` is the
 * selected/soft tint that `accentText` and `muted` both stay AA on.
 */
import { COMMON_SPACING_SCALE } from "../common/spacing.js"
export const STARCI_CORE_DNA = Object.freeze({
    id: "core",
    version: 1,
    paths: Object.freeze(["common/", "core/"]),
    vendor: Object.freeze({ name: "heroui", parity: "strict" }),
    arrangement: Object.freeze({
        indicatorSide: Object.freeze({
            default: "vendor",
            "Dropdown.ItemIndicator": Object.freeze({ default: "start", submenu: "end" }),
            "ListBox.ItemIndicator": "end",
            "Select.Indicator": "end",
        }),
        separators: "between-sections",
        iconSize: Object.freeze({
            default: "vendor",
            "Dropdown.Item:leading-glyph-size": "20px",
            "Switch.Icon:glyph-size": Object.freeze({ md: "16px", lg: "20px", control: "20px" }),
        }),
        density: "vendor",
    }),
    collectionItem: Object.freeze({
        descriptionLines: 1,
        unreadWeight: 600,
    }),
    /**
     * The avatar's solid backgrounds: Grammar's own theme tones (`theme.css`) as the hex each resolves to, because the generated avatar is an SVG in an
     * `<img>` and cannot read a CSS variable. `token` and `mode` name the theme token; a spec checks every hex against `theme.css` and its contrast.
     */
    avatar: Object.freeze({
        palette: Object.freeze([
            Object.freeze({ token: "--accent", mode: "light", hex: "#7547ff" }),
            Object.freeze({ token: "--success", mode: "light", hex: "#00aa65" }),
            Object.freeze({ token: "--warning", mode: "light", hex: "#c28a00" }),
            Object.freeze({ token: "--danger", mode: "light", hex: "#cb3000" }),
            Object.freeze({ token: "--success", mode: "dark", hex: "#00cc84" }),
            Object.freeze({ token: "--warning", mode: "dark", hex: "#e9bf4b" }),
            Object.freeze({ token: "--danger", mode: "dark", hex: "#f4714c" }),
            Object.freeze({ token: "--foreground", mode: "light", hex: "#191818" }),
        ] as const),
        /** The letter inks: white on a dark tone, the light theme's foreground on a light one (identity.ts avatarInk picks per tone). */
        inks: Object.freeze({ light: "#ffffff", dark: "#191818" } as const),
    }),
    color: Object.freeze({
        accent: "#7547ff",
        accentForeground: "oklch(100% 0 0)",
        focus: "#7248ff",
        light: Object.freeze({
            canvas: "oklch(97.02% 0.0015 354.13)",
            surface: "oklch(100% 0.0008 354.13)",
            surfaceSecondary: "oklch(95.24% 0.0012 354.13)",
            surfaceTertiary: "oklch(93.73% 0.0012 354.13)",
            foreground: "oklch(21.03% 0.0015 354.13)",
            muted: "oklch(52% 0.003 354.13)",
            border: "oklch(90% 0.0015 354.13)",
            separator: "oklch(92% 0.0015 354.13)",
            success: "oklch(62.8% 0.1941 162.85)",
            successForeground: "oklch(21.03% 0.0059 162.85)",
            warning: "oklch(67% 0.159 84.37)",
            warningForeground: "oklch(21.03% 0.0059 84.37)",
            danger: "oklch(55% 0.2 37.78)",
            dangerForeground: "oklch(99.11% 0 0)",
            /** Grammar's own built-in info pair (common/tones-info.css, 0.55.0): HeroUI ships none. */
            info: "oklch(54% 0.18 255)",
            infoForeground: "oklch(99.11% 0 0)",
            accentText: "#6a3cf2",
            accentSoft: "oklch(95.5% 0.03 287)",
        }),
        dark: Object.freeze({
            canvas: "oklch(12% 0.0015 354.13)",
            surface: "oklch(21.03% 0.003 354.13)",
            surfaceSecondary: "oklch(25.7% 0.0023 354.13)",
            surfaceTertiary: "oklch(27.21% 0.0023 354.13)",
            foreground: "oklch(99.11% 0.0015 354.13)",
            muted: "oklch(70.5% 0.003 354.13)",
            border: "oklch(28% 0.0015 354.13)",
            separator: "oklch(25% 0.0015 354.13)",
            success: "oklch(73.29% 0.1941 162.85)",
            successForeground: "oklch(21.03% 0.0059 162.85)",
            warning: "oklch(82.03% 0.1392 88.38)",
            warningForeground: "oklch(21.03% 0.0059 88.38)",
            danger: "oklch(70% 0.17 36.67)",
            dangerForeground: "oklch(21.03% 0.0059 36.67)",
            info: "oklch(72% 0.15 250)",
            infoForeground: "oklch(21.03% 0.0059 250)",
            accentText: "#a48bff",
            accentSoft: "oklch(30% 0.07 287)",
        }),
    }),
    geometry: Object.freeze({
        pageMeasure: "80rem",
        readingMeasure: "72ch",
        surfaceRadius: "min(32px, var(--radius-3xl))",
        controlRadius: "0.75rem",
        pillRadius: "999px",
    }),
    rhythm: Object.freeze({
        inlineGap: "0.5rem",
        rowGap: "0.75rem",
        sectionGap: "1rem",
        regionGap: "1.5rem",
        pageInset: "clamp(1rem, 3vw, 2rem)",
    }),
    elevation: Object.freeze({
        surface: "0 8px 28px oklch(21.03% 0.0059 354.13 / 0.07)",
        surfaceLayers: Object.freeze({
            top: "shadow without border",
            nested: "border without shadow",
        }),
    }),
    motion: Object.freeze({
        duration: "180ms",
        easing: "cubic-bezier(0.2, 0, 0, 1)",
    }),
} as const)

/** The family spacing scale is Common's (common/spacing.ts): the family does not re-space. */
export const STARCI_CORE_SPACING_SCALE = COMMON_SPACING_SCALE

export type StarCiCoreSpacingStep = keyof typeof STARCI_CORE_SPACING_SCALE
export type StarCiCoreSpacingValue = (typeof STARCI_CORE_SPACING_SCALE)[StarCiCoreSpacingStep]

/**
 * Sticky-band geometry the package PUBLISHES rather than expects.
 *
 * These are not theme tokens and they are not theme tokens: a
 * theme token has one default the family always defines, while each of these is either derived from
 * what is actually on the page or supplied by a host that wants to override that. A consumer reads
 * them; only `railOffset` is meant to be written.
 *
 * - `bandOffset` - where the sticky band stack stops. Defined only while a sticky
 *   `TopBar` is present, so `var(--starci-core-band-offset, X)` keeps
 *   falling back to a page's own X when there is no band. A page pins to it with
 *   `top: var(--starci-core-band-offset)` and bounds itself with
 *   `max-height: calc(100dvh - var(--starci-core-band-offset))`.
 * - `bandHeight` - the navigation band alone: 4rem plus its separator, plus the md control height when a
 *   `subnavigation` layer is stacked on it.
 * - `railOffset` - the host override. Unset, it reads the published band.
 */
export const STARCI_CORE_BAND_TOKEN_NAMES = Object.freeze({
    bandOffset: "--starci-core-band-offset",
    bandHeight: "--starci-core-band-height",
    railOffset: "--starci-core-rail-offset",
} as const)

export type StarCiCoreBandTokenName = (typeof STARCI_CORE_BAND_TOKEN_NAMES)[keyof typeof STARCI_CORE_BAND_TOKEN_NAMES]

export type StarCiCoreDna = typeof STARCI_CORE_DNA

