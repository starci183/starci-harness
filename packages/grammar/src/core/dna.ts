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
 * the current tab and bottom-nav label, the section eyebrow, the soft accent pairing - the family
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
    intent: Object.freeze({
        commit: Object.freeze({ decision: "primary", item: "secondary", chrome: "primary" }),
        alternative: "secondary",
        dismiss: "tertiary",
        neutral: Object.freeze({
            button: Object.freeze({ decision: "outline", item: "ghost", chrome: "ghost" }),
            iconButton: Object.freeze({ decision: "outline", item: "ghost", chrome: "ghost", navbar: "tertiary" }),
        }),
        destructive: Object.freeze({ entry: "danger-soft", confirm: "danger" }),
    }),
    collectionItem: Object.freeze({
        descriptionLines: 1,
        unreadWeight: 600,
    }),
    avatar: Object.freeze({
        style: "initials",
        borderRadius: 0,
        idRandomization: false,
        agentBadgeMinSize: 32,
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
            info: "oklch(66.8% 0.17 250)",
            infoForeground: "oklch(21.03% 0.0059 250)",
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
            info: "oklch(72% 0.17 250)",
            infoForeground: "oklch(21.03% 0.0059 250)",
            accentText: "#a48bff",
            accentSoft: "oklch(30% 0.07 287)",
        }),
    }),
    geometry: Object.freeze({
        pageMeasure: "80rem",
        readingMeasure: "72ch",
        surfaceRadius: "1rem",
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
 * The custom properties Core's theme sets: HeroUI's own tokens, which an app sets in its CSS (`core/theme.css` holds the
 * defaults), and the geometry and motion names Core defines on its root.
 *
 * @deprecated The defaults live in `@starci/grammar/core/theme.css`; this list is kept until the apps have migrated.
 */
export const STARCI_CORE_TOKEN_NAMES = Object.freeze({
    accent: "--accent",
    accentForeground: "--accent-foreground",
    focus: "--focus",
    canvas: "--background",
    surface: "--surface",
    surfaceSecondary: "--surface-secondary",
    surfaceTertiary: "--surface-tertiary",
    foreground: "--foreground",
    muted: "--muted",
    border: "--border",
    separator: "--separator",
    success: "--success",
    successForeground: "--success-foreground",
    warning: "--warning",
    warningForeground: "--warning-foreground",
    danger: "--danger",
    dangerForeground: "--danger-foreground",
    info: "--info",
    infoForeground: "--info-foreground",
    accentText: "--accent-soft-foreground",
    accentSoft: "--accent-soft",
    pageMeasure: "--starci-core-page-measure",
    readingMeasure: "--starci-core-reading-measure",
    surfaceRadius: "--starci-core-surface-radius",
    controlRadius: "--radius",
    pillRadius: "--starci-core-pill-radius",
    pageInset: "--starci-core-page-inset",
    inlineGap: "--starci-core-inline-gap",
    rowGap: "--starci-core-row-gap",
    sectionGap: "--starci-core-section-gap",
    regionGap: "--starci-core-region-gap",
    elevation: "--surface-shadow",
    motionDuration: "--starci-core-motion-duration",
    motionEasing: "--starci-core-motion-easing",
} as const)

/**
 * Sticky-band geometry the package PUBLISHES rather than expects.
 *
 * These are not theme tokens and they are deliberately absent from `STARCI_CORE_TOKEN_NAMES`: a
 * theme token has one default the family always defines, while each of these is either derived from
 * what is actually on the page or supplied by a host that wants to override that. A consumer reads
 * them; only `railOffset` and `subnavOffset` are meant to be written.
 *
 * - `bandOffset` - where the sticky band stack stops. Defined only while a sticky
 *   `NavigationFeatureNav` or `Subnav` is present, so `var(--starci-core-band-offset, X)` keeps
 *   falling back to a page's own X when there is no band. A page pins to it with
 *   `top: var(--starci-core-band-offset)` and bounds itself with
 *   `max-height: calc(100dvh - var(--starci-core-band-offset))`.
 * - `bandHeight` - the navigation band alone: 4rem plus its separator, plus 2rem when a feature
 *   layer is stacked on it.
 * - `bandSubnavHeight` - a stacked sticky `Subnav`, which contributes nothing once a compact one is
 *   hidden at 70rem.
 * - `railOffset` / `subnavOffset` - the host overrides. Unset, each reads the published band.
 */
export const STARCI_CORE_BAND_TOKEN_NAMES = Object.freeze({
    bandOffset: "--starci-core-band-offset",
    bandHeight: "--starci-core-band-height",
    bandSubnavHeight: "--starci-core-band-subnav-height",
    railOffset: "--starci-core-rail-offset",
    subnavOffset: "--starci-core-subnav-offset",
} as const)

export type StarCiCoreBandTokenName = (typeof STARCI_CORE_BAND_TOKEN_NAMES)[keyof typeof STARCI_CORE_BAND_TOKEN_NAMES]

export type StarCiCoreDna = typeof STARCI_CORE_DNA
export type StarCiCoreTokenName = (typeof STARCI_CORE_TOKEN_NAMES)[keyof typeof STARCI_CORE_TOKEN_NAMES]

/** @deprecated The values of `@starci/grammar/core/theme.css`, kept until the apps have migrated. */
export const STARCI_CORE_TOKEN_DEFAULTS = Object.freeze({
    "--accent": STARCI_CORE_DNA.color.accent,
    "--accent-foreground": STARCI_CORE_DNA.color.accentForeground,
    "--focus": STARCI_CORE_DNA.color.focus,
    "--background": STARCI_CORE_DNA.color.light.canvas,
    "--surface": STARCI_CORE_DNA.color.light.surface,
    "--surface-secondary": STARCI_CORE_DNA.color.light.surfaceSecondary,
    "--surface-tertiary": STARCI_CORE_DNA.color.light.surfaceTertiary,
    "--foreground": STARCI_CORE_DNA.color.light.foreground,
    "--muted": STARCI_CORE_DNA.color.light.muted,
    "--border": STARCI_CORE_DNA.color.light.border,
    "--separator": STARCI_CORE_DNA.color.light.separator,
    "--success": STARCI_CORE_DNA.color.light.success,
    "--success-foreground": STARCI_CORE_DNA.color.light.successForeground,
    "--warning": STARCI_CORE_DNA.color.light.warning,
    "--warning-foreground": STARCI_CORE_DNA.color.light.warningForeground,
    "--danger": STARCI_CORE_DNA.color.light.danger,
    "--danger-foreground": STARCI_CORE_DNA.color.light.dangerForeground,
    "--info": STARCI_CORE_DNA.color.light.info,
    "--info-foreground": STARCI_CORE_DNA.color.light.infoForeground,
    "--accent-soft-foreground": STARCI_CORE_DNA.color.light.accentText,
    "--accent-soft": STARCI_CORE_DNA.color.light.accentSoft,
    "--starci-core-page-measure": STARCI_CORE_DNA.geometry.pageMeasure,
    "--starci-core-reading-measure": STARCI_CORE_DNA.geometry.readingMeasure,
    "--starci-core-surface-radius": STARCI_CORE_DNA.geometry.surfaceRadius,
    "--radius": STARCI_CORE_DNA.geometry.controlRadius,
    "--starci-core-pill-radius": STARCI_CORE_DNA.geometry.pillRadius,
    "--starci-core-page-inset": STARCI_CORE_DNA.rhythm.pageInset,
    "--starci-core-inline-gap": STARCI_CORE_DNA.rhythm.inlineGap,
    "--starci-core-row-gap": STARCI_CORE_DNA.rhythm.rowGap,
    "--starci-core-section-gap": STARCI_CORE_DNA.rhythm.sectionGap,
    "--starci-core-region-gap": STARCI_CORE_DNA.rhythm.regionGap,
    "--surface-shadow": STARCI_CORE_DNA.elevation.surface,
    "--starci-core-motion-duration": STARCI_CORE_DNA.motion.duration,
    "--starci-core-motion-easing": STARCI_CORE_DNA.motion.easing,
} satisfies Readonly<Record<StarCiCoreTokenName, string>>)

/** @deprecated The `.dark` values of `@starci/grammar/core/theme.css`, kept until the apps have migrated. */
export const STARCI_CORE_DARK_TOKEN_DEFAULTS = Object.freeze({
    "--background": STARCI_CORE_DNA.color.dark.canvas,
    "--surface": STARCI_CORE_DNA.color.dark.surface,
    "--surface-secondary": STARCI_CORE_DNA.color.dark.surfaceSecondary,
    "--surface-tertiary": STARCI_CORE_DNA.color.dark.surfaceTertiary,
    "--foreground": STARCI_CORE_DNA.color.dark.foreground,
    "--muted": STARCI_CORE_DNA.color.dark.muted,
    "--border": STARCI_CORE_DNA.color.dark.border,
    "--separator": STARCI_CORE_DNA.color.dark.separator,
    "--success": STARCI_CORE_DNA.color.dark.success,
    "--success-foreground": STARCI_CORE_DNA.color.dark.successForeground,
    "--warning": STARCI_CORE_DNA.color.dark.warning,
    "--warning-foreground": STARCI_CORE_DNA.color.dark.warningForeground,
    "--danger": STARCI_CORE_DNA.color.dark.danger,
    "--danger-foreground": STARCI_CORE_DNA.color.dark.dangerForeground,
    "--info": STARCI_CORE_DNA.color.dark.info,
    "--info-foreground": STARCI_CORE_DNA.color.dark.infoForeground,
    "--accent-soft-foreground": STARCI_CORE_DNA.color.dark.accentText,
    "--accent-soft": STARCI_CORE_DNA.color.dark.accentSoft,
} satisfies Readonly<Partial<Record<StarCiCoreTokenName, string>>>)

export type StarCiCoreTokenDefaults = typeof STARCI_CORE_TOKEN_DEFAULTS
