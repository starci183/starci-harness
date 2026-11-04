import { withRegionLoading } from "../../regionScope.js"
import { ColorSwatch as HeroColorSwatch, type ColorSwatchProps as HeroColorSwatchProps } from "@heroui/react"
import { SkeletonPlaceholder } from "../Skeleton/index.js"
import type { NoChildren } from "../../tier.js"

export type ColorSwatchProps = NoChildren & {
    /** The literal color being reported as content, never a theme or status tone. */
    readonly color: NonNullable<HeroColorSwatchProps["color"]>
    /** App-owned name of the color and its purpose. Keep the value visible in accompanying copy. */
    readonly label: string
    readonly isLoading?: boolean
}

/** A named preview of an actual color value; the vendor owns its paint and transparency checkerboard. */
const ColorSwatchInner = ({ color, label, isLoading = false }: ColorSwatchProps) => {
    const swatch = (
        <HeroColorSwatch
            aria-label={label}
            colorName={label}
            color={color}
            shape="square"
            size="sm"
            data-component="ColorSwatch"
            data-tier="leaf"
        />
    )
    return isLoading ? <SkeletonPlaceholder shape="block">{swatch}</SkeletonPlaceholder> : swatch
}

/** A named preview of an actual color value; the vendor owns its paint and transparency checkerboard. */
export const ColorSwatch = withRegionLoading(ColorSwatchInner)
