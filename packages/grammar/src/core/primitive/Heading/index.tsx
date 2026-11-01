import { Typography, cn, skeletonVariants } from "@heroui/react"
import type { ReactNode } from "react"

export type HeadingLevel = 1 | 2 | 3 | 4
export type HeadingScale = "standard" | "display"

export type HeadingProps = {
    readonly children: ReactNode
    /** Outline semantics and the standard visual recipe move together. */
    readonly level?: HeadingLevel
    /** Display changes emphasis without changing the document outline. */
    readonly scale?: HeadingScale
    readonly isSkeleton?: boolean
    readonly isVisuallyHidden?: boolean
}

/** font.md Scale: FONT-4/FONT-3/FONT-2/FONT-1 for level 1..4; level 4 also matches tone.md TONE-2 (muted). The look is the stylesheet's, keyed on `data-level` and `data-scale`. */
const FONT_RULE_BY_LEVEL = {
    1: "FONT-4",
    2: "FONT-3",
    3: "FONT-2",
    4: "FONT-1",
} as const
const SKELETON_CLASS_NAME = skeletonVariants({ animationType: "shimmer" }).base({
    className: "select-none text-transparent",
})

/** Semantic heading whose outline level never changes merely to obtain a visual size. */
export const Heading = ({
    children,
    level = 2,
    scale = "standard",
    isSkeleton = false,
    isVisuallyHidden = false,
}: HeadingProps) => (
    <Typography.Heading
        data-tier="atom"
        data-component="Heading"
        data-level={level}
        data-scale={scale}
        data-loading={isSkeleton ? "true" : "false"}
        aria-hidden={isSkeleton || undefined}
        data-contract={
            scale === "display"
                ? "FONT-6"
                : level === 4
                    ? `${FONT_RULE_BY_LEVEL[4]} TONE-2`
                    : FONT_RULE_BY_LEVEL[level]
        }
        level={level}
        className={cn(
            isSkeleton ? SKELETON_CLASS_NAME : undefined,
            isVisuallyHidden ? "sr-only" : undefined,
        ) ?? ""}
    >
        {children}
    </Typography.Heading>
)
