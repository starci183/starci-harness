import { ProgressBar, skeletonVariants } from "@heroui/react"

/** The colour of the fill: the meaning of what is measured. `accent` is the default. */
export type ProgressTone = "accent" | "success" | "warning" | "danger" | "info"

export type ProgressProps = {
    /** What the bar measures. Required because the visible bar has no drawn label. */
    readonly label: string
    /** Completion from 0 to 100. Validation remains with the resolving application. */
    readonly value?: number
    /** Initial unresolved-content geometry, not a zero-valued measurement. */
    readonly isSkeleton?: boolean
    /**
     * Step mode for a wizard: one segment per step at the bar's own height, the finished and current steps filled.
     * `completed` counts filled segments (current step included); `value` is ignored in this mode.
     */
    readonly steps?: { readonly total: number; readonly completed: number }
    /**
     * The spoken reading, e.g. "56 of 120 chunks, paused". In step mode it defaults to "completed / total"; on a bar it is
     * `aria-valuetext`, and without it a screen reader reads the percentage.
     */
    readonly valueText?: string
    /** The fill colour, from what the bar measures (a paused job `warning`, a failed one `danger`). Defaults to `accent`. */
    readonly tone?: ProgressTone
}

/**
 * Fluid width and the resting bar's height are SHIPPED by `.starci-core-progress` in
 * `src/common/styles.css`, keyed by `data-loading`.
 */
const SKELETON_CLASS_NAME = skeletonVariants({ animationType: "shimmer" }).base({
    className: "starci-core-progress",
})

/** Accessible, full-width completion bar with an inert initial-loading shape. */
export const Progress = ({ label, value = 0, isSkeleton = false, steps, valueText, tone = "accent" }: ProgressProps) => {
    if (steps !== undefined && !isSkeleton) {
        const total = Math.max(1, Math.round(steps.total))
        const completed = Math.min(total, Math.max(0, Math.round(steps.completed)))
        return (
            <ProgressBar
                aria-label={label}
                size="sm"
                minValue={0}
                maxValue={total}
                value={completed}
                valueLabel={valueText ?? `${completed} / ${total}`}
                data-tier="atom"
                data-component="Progress"
                data-loading="false"
                data-grammar-progress-mode="steps"
                data-grammar-progress-tone={tone}
                data-contract="MEASURE-2"
                className="starci-core-progress"
            >
                <ProgressBar.Track className="starci-core-progress-steps" style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}>
                    {Array.from({ length: total }, (_, index) => (
                        <span key={index} aria-hidden className="starci-core-progress-step" data-grammar-progress-step={index < completed ? "done" : "todo"} />
                    ))}
                </ProgressBar.Track>
            </ProgressBar>
        )
    }
    if (isSkeleton) {
        return (
            <span
                data-tier="atom"
                data-component="Progress"
                data-loading="true"
                aria-hidden
                // Fluid width matches MEASURE-2. The resting bar's 0.5rem height is a fixed
                // height, which measure.md excludes from its catalog on purpose, so it stays unclaimed.
                data-contract="MEASURE-2"
                className={SKELETON_CLASS_NAME}
            />
        )
    }

    return (
        <ProgressBar
            data-tier="atom"
            data-component="Progress"
            data-loading="false"
            aria-label={label}
            value={value}
            minValue={0}
            maxValue={100}
            {...(valueText === undefined ? {} : { valueLabel: valueText })}
            data-grammar-progress-tone={tone}
            size="sm"
            // Fluid width matches MEASURE-2 in measure.md `## Scale`/catalog.
            data-contract="MEASURE-2"
            className="starci-core-progress"
        >
            <ProgressBar.Track>
                <ProgressBar.Fill />
            </ProgressBar.Track>
        </ProgressBar>
    )
}
