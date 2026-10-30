import { navigationClassName } from "../../navigationClassNames.js"
import { Image } from "../Image/index.js"
import { assetSlotAttributes, type AssetSlotProps } from "../Image/assetSlot.js"

/** The mascot size scale: three square boxes and the hero that fills its container's height up to a cap. */
export type MascotSize = "sm" | "md" | "lg" | "hero"

/** Where a hero mascot shows: `wide` (the default) only from the lg breakpoint (64rem) up; `always` at every width. */
export type MascotVisibility = "wide" | "always"

/** The Common tokens that size each step; values are set once on the Grammar root (`common/styles.css`). */
export const MASCOT_SIZE_TOKENS = Object.freeze({
    sm: "--grammar-mascot-sm",
    md: "--grammar-mascot-md",
    lg: "--grammar-mascot-lg",
    hero: "--grammar-mascot-hero-max",
} as const)

export type MascotProps = AssetSlotProps & {
    readonly src: string
    /**
     * Decorative by default: `""` hides the mascot from assistive technology. A non-empty alt makes it meaningful and
     * names it.
     */
    readonly alt?: string
    /** sm 96px, md 160px, lg 240px square; hero fills its container's height up to `--grammar-mascot-hero-max`. */
    readonly size?: MascotSize
    /** Offscreen art defers by default; above-the-fold art may be eager. */
    readonly loading?: "lazy" | "eager"
    /** A hero only: keep it below the lg breakpoint (`always`, stepped down to the lg box) instead of hiding it. */
    readonly visibility?: MascotVisibility
    readonly className?: string
}

/**
 * Generated character art at one size scale, so the same mascot renders at the same size on every screen.
 *
 * The art is always contained (never cropped), on a transparent ground with no loading plate, inside a square box of
 * the step's token; the hero step fills its container's height up to the hero cap, for a split screen such as a
 * sign-in page. Below 48rem each square step drops one step (lg to md, md to sm); a hero is absent below the lg
 * breakpoint (64rem) unless `visibility="always"` keeps it, as the lg box (md below 48rem). Decorative unless `alt`
 * names it (A11Y-2). The asset-slot props tie the render to the asset workflow's request, as on `Image` and
 * `MediaFrame`; the grammar lint requires `assetSlot` on every Mascot.
 */
export const Mascot = ({
    src,
    alt = "",
    size = "md",
    loading = "lazy",
    visibility = "wide",
    className,
    ...assetSlot
}: MascotProps) => (
    <span
        className={navigationClassName("starci-core-mascot", className)}
        data-component="Mascot"
        data-tier="atom"
        data-contract="A11Y-2"
        data-grammar-mascot-size={size}
        data-grammar-mascot-visibility={size === "hero" ? visibility : undefined}
        {...(alt === "" ? { "aria-hidden": true } : {})}
        {...assetSlotAttributes(assetSlot)}
    >
        <Image src={src} alt={alt} aspect="auto" fit="contain" plate="none" loading={loading} />
    </span>
)
