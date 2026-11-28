import { Typography, cn, skeletonVariants } from "@heroui/react"

export type HeadingLevel = 1 | 2 | 3 | 4
export type HeadingScale = "standard" | "title" | "display"

export type HeadingProps = {
    readonly children: string
    /** Outline semantics and the standard visual recipe move together. */
    readonly level?: HeadingLevel
    /**
     * Display changes emphasis without changing the document outline. `title` is the middle step (24px, semibold, tight leading) for the
     * head of a first-run or lobby screen and a welcome card; `display` is the 36px hero.
     */
    readonly scale?: HeadingScale
    readonly isLoading?: boolean
    readonly isVisuallyHidden?: boolean
}

/**
 * font.md Scale: FONT-4/FONT-3/FONT-2/FONT-1 for level 1..4; level 4 also matches tone.md TONE-2 (muted). The look is the stylesheet's,
 * keyed on `data-level` and `data-scale`: level 1 the page title (18 / 500), levels 2 and 3 the title.section role (16 / 24 / 500, a
 * Section title's type, so a bare heading and a Section of one level match), level 4 the muted 12.
 */
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
    isLoading = false,
    isVisuallyHidden = false,
}: HeadingProps) => (
    <Typography.Heading
        data-tier="leaf"
        data-component="Heading"
        data-level={level}
        data-scale={scale}
        data-loading={isLoading ? "true" : "false"}
        aria-hidden={isLoading || undefined}
        data-contract={
            scale === "display"
                ? "FONT-6"
                : level === 4
                    ? `${FONT_RULE_BY_LEVEL[4]} TONE-2`
                    : FONT_RULE_BY_LEVEL[level]
        }
        level={level}
        className={cn(
            isLoading ? SKELETON_CLASS_NAME : undefined,
            isVisuallyHidden ? "sr-only" : undefined,
        ) ?? ""}
    >
        {children}
    </Typography.Heading>
)
