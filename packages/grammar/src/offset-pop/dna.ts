/**
 * Stable visual identity shipped by the Offset Pop Grammar family.
 *
 * Same shape as `STARCI_CORE_DNA`, key for key, plus two family groups: `offset` (the hard
 * offset shadow and ink outline that make the family recognisable) and `palette` (the named
 * inks the semantic colours are drawn from). This is presentation data, not a registry of UI
 * laws, and it is product-neutral. Every value equals the default in `./theme.css`.
 *
 * WCAG 2.x contrast, recorded here:
 *
 * | pair                                   | light | dark  | need |
 * | -------------------------------------- | ----- | ----- | ---- |
 * | foreground on canvas                   | 16.86 | 17.47 | 4.5  |
 * | foreground on surface                  | 17.49 | 15.44 | 4.5  |
 * | foreground on surfaceSecondary         | 13.78 | 12.80 | 4.5  |
 * | muted on canvas                        |  5.81 | 10.16 | 4.5  |
 * | muted on surface                       |  6.03 |  8.98 | 4.5  |
 * | muted on surfaceSecondary              |  4.75 |  7.45 | 4.5  |
 * | accentForeground on accent             |  5.23 |  5.23 | 4.5  |
 * | successForeground on success           | 11.97 | 11.97 | 4.5  |
 * | warningForeground on warning           | 12.49 | 12.49 | 4.5  |
 * | dangerForeground on danger             |  4.72 |  4.72 | 4.5  |
 * | infoForeground on info                 | 13.50 | 13.50 | 4.5  |
 * | focus on canvas (non-text, 1.4.11)     |  3.22 |  5.42 | 3    |
 * | focus on surface (non-text, 1.4.11)    |  3.34 |  4.79 | 3    |
 * | accentText on canvas                   |  6.22 |  7.65 | 4.5  |
 * | accentText on surface                  |  6.45 |  6.76 | 4.5  |
 * | accentText on surfaceSecondary         |  5.09 |  5.61 | 4.5  |
 * | accentText on blush (palette/info)     |  4.98 |   -   | 4.5  |
 *
 * The accent foreground is the ink, not white: white on the family pink is 3.40:1, which fails
 * AA for button-size text. The same reasoning puts ink on the critical red (white is 3.77:1).
 * Pink as body-size TEXT on the light canvas is only 3.22:1, so `accent` stays the fill and the
 * focus ring and every place the accent paints text reads `accentText` instead: a deeper
 * raspberry in light, a lighter candy pink in dark. `accentText` and `accentSoft` (the selected
 * and soft tint, the blush secondary surface in light and the plum one in dark) mirror Core's
 * keys of the same names.
 */
import { COMMON_SPACING_SCALE } from "../common/spacing.js"
export const OFFSET_POP_DNA = Object.freeze({
    id: "offset-pop",
    version: 1,
    paths: Object.freeze(["offset-pop/"]),
    vendor: Object.freeze({ name: "heroui", parity: "custom" }),
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
    color: Object.freeze({
        accent: "#ff3593",
        accentForeground: "#1c1524",
        focus: "#ff3593",
        light: Object.freeze({
            canvas: "#fff8ef",
            surface: "#fffdf9",
            surfaceSecondary: "#f8dbe8",
            foreground: "#1c1524",
            muted: "#675f6c",
            border: "#1c1524",
            separator: "#1c1524",
            success: "#91e4ca",
            successForeground: "#1c1524",
            warning: "#ffd447",
            warningForeground: "#1c1524",
            danger: "#e84a5f",
            dangerForeground: "#1c1524",
            info: "#f8d8e6",
            infoForeground: "#1c1524",
            accentText: "#b8005f",
            accentSoft: "#f8dbe8",
        }),
        dark: Object.freeze({
            canvas: "#17121d",
            surface: "#251d2c",
            surfaceSecondary: "#3b2936",
            foreground: "#fff8ef",
            muted: "#c8bdca",
            border: "#fff8ef",
            separator: "#fff8ef",
            success: "#91e4ca",
            successForeground: "#1c1524",
            warning: "#ffd447",
            warningForeground: "#1c1524",
            danger: "#e84a5f",
            dangerForeground: "#1c1524",
            info: "#f8d8e6",
            infoForeground: "#1c1524",
            accentText: "#ff7ab8",
            accentSoft: "#3b2936",
        }),
    }),
    geometry: Object.freeze({
        pageMeasure: "80rem",
        readingMeasure: "72ch",
        surfaceRadius: "1.5rem",
        controlRadius: "1rem",
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
        /** Composed from `offset`, so it follows the theme's shadow ink and the narrow-viewport drop. */
        surface: "var(--offset-pop-shadow-x) var(--offset-pop-shadow-y) 0 var(--offset-pop-shadow-ink)",
    }),
    motion: Object.freeze({
        duration: "140ms",
        easing: "cubic-bezier(.2, .8, .2, 1)",
    }),
    offset: Object.freeze({
        x: "0.25rem",
        y: "0.5rem",
        outlineWidth: "2px",
        ink: "#1c1524",
        shadowInk: "#1c1524",
        /** Dark ink is the outline and text colour (it flips to cream); the shadow stays near-black. */
        dark: Object.freeze({
            ink: "#fff8ef",
            shadowInk: "#050306",
        }),
    }),
    palette: Object.freeze({
        pink: "#ff3593",
        blush: "#f8d8e6",
        yellow: "#ffd447",
        mint: "#91e4ca",
        critical: "#e84a5f",
    }),
} as const)

/** The family spacing scale is Common's (common/spacing.ts): the family does not re-space. */
export const OFFSET_POP_SPACING_SCALE = COMMON_SPACING_SCALE

export type OffsetPopSpacingStep = keyof typeof OFFSET_POP_SPACING_SCALE
export type OffsetPopSpacingValue = (typeof OFFSET_POP_SPACING_SCALE)[OffsetPopSpacingStep]

/**
 * Sticky-band geometry published under an Offset Pop root.
 *
 * Common, not the family, publishes the band: `src/common/styles.css` defines these on every
 * `.grammar-common-root` that holds a sticky `TopBar`, whatever its
 * family, and reads the two host overrides. So the names are Common's, shared with Core; the
 * family re-exports them so a consumer reads them from `@starci/grammar/offset-pop`. They are
 * not theme tokens; Offset Pop CSS never writes them.
 * See `STARCI_CORE_BAND_TOKEN_NAMES` for what each one means.
 */
export const OFFSET_POP_BAND_TOKEN_NAMES = Object.freeze({
    bandOffset: "--starci-core-band-offset",
    bandHeight: "--starci-core-band-height",
    railOffset: "--starci-core-rail-offset",
} as const)

export type OffsetPopBandTokenName = (typeof OFFSET_POP_BAND_TOKEN_NAMES)[keyof typeof OFFSET_POP_BAND_TOKEN_NAMES]

export type OffsetPopDna = typeof OFFSET_POP_DNA

