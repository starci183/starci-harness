"use client"

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { prefersReducedMotion, supportsViewTimeline } from "../../motion.js"
import type { NoChildren } from "../../tier.js"

/** One step of the story: the words the reader scrolls past and the picture that stands beside them while they do. */
export type StickyStoryStep = {
    readonly id: string
    /** The text of the step: a heading and a few lines, the app's own. It stays in the page's reading order, in the list of steps. */
    readonly content: ReactNode
    /** What the pinned stage shows while this step is the current one (a picture, a product view). It is drawn twice, once in the stage and once under its step, so it holds no `id` of its own. */
    readonly panel: ReactNode
}

export type StickyStoryProps = NoChildren & {
    /** Names the sequence for assistive technology, e.g. "How a request travels". */
    readonly label: string
    /** The steps, in order. Two or more: one step is a picture beside a paragraph and needs no story. */
    readonly steps: readonly [StickyStoryStep, StickyStoryStep, ...StickyStoryStep[]]
    /** The side the stage pins on, in reading order. Default `end`. */
    readonly stage?: "start" | "end"
}

type StoryStyle = CSSProperties & {
    readonly "--grammar-story-scope"?: string
    readonly "--grammar-story-timeline"?: string
}

const timelineName = (index: number): string => `--grammar-story-${index}`
const positionOf = (index: number, count: number): "first" | "mid" | "last" => index === 0 ? "first" : index === count - 1 ? "last" : "mid"

/**
 * A pinned stage whose picture changes as the text beside it scrolls past (0.47.3). On a wide screen with motion allowed, the stage stays under the page's top
 * edge while each step passes, and the panel of the step in the middle of the viewport is the one shown: the stylesheet drives it with one view timeline per
 * step (`animation-timeline`), and where the browser has none a small observer sets the current step. On a phone and under reduced motion there is no stage:
 * every step shows its own panel below its text, in order, so nothing is hidden, moved or lost.
 */
export const StickyStory = ({ label, steps, stage = "end" }: StickyStoryProps) => {
    const ref = useRef<HTMLDivElement>(null)
    const [mode, setMode] = useState<"static" | "observed">("static")
    const [active, setActive] = useState(0)
    useEffect(() => {
        const node = ref.current
        if (node === null || supportsViewTimeline() || prefersReducedMotion() || typeof IntersectionObserver === "undefined") return undefined
        setMode("observed")
        const items = Array.from(node.querySelectorAll<HTMLElement>("[data-grammar-story-step]"))
        // The step crossing the middle line of the viewport is the current one.
        const observer = new IntersectionObserver((entries) => {
            for (const entry of entries) if (entry.isIntersecting) setActive(items.indexOf(entry.target as HTMLElement))
        }, { rootMargin: "-50% 0px -50% 0px" })
        for (const item of items) observer.observe(item)
        return () => observer.disconnect()
    }, [])
    const scope: StoryStyle = { "--grammar-story-scope": steps.map((_, index) => timelineName(index)).join(", ") }
    return (
        <div
            ref={ref}
            data-tier="branch"
            data-component="StickyStory"
            data-contract="MOTION-1 MOTION-2 MOTION-3"
            className="starci-core-story"
            data-grammar-story-stage={stage}
            data-grammar-story-mode={mode}
            style={scope}
        >
            <ol className="starci-core-story-steps" aria-label={label}>
                {steps.map((step, index) => {
                    const style: StoryStyle = { "--grammar-story-timeline": timelineName(index) }
                    return (
                        <li key={step.id} className="starci-core-story-step" data-grammar-story-step={step.id} style={style}>
                            <div className="starci-core-story-copy">{step.content}</div>
                            <div className="starci-core-story-inline">{step.panel}</div>
                        </li>
                    )
                })}
            </ol>
            <div className="starci-core-story-pin" aria-hidden="true" inert>
                <div className="starci-core-story-stage">
                    {steps.map((step, index) => {
                        const style: StoryStyle = { "--grammar-story-timeline": timelineName(index) }
                        return (
                            <div
                                key={step.id}
                                className="starci-core-story-panel"
                                data-grammar-story-panel={step.id}
                                data-grammar-story-position={positionOf(index, steps.length)}
                                data-active={mode === "observed" && active === index ? "true" : undefined}
                                style={style}
                            >
                                {step.panel}
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
