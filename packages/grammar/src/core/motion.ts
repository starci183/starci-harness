/**
 * The two questions every marketing motion piece asks of the browser before it moves anything (0.47.3). Both are read in an effect,
 * never during render, so the server and the first client render draw the same static, complete content.
 */

/** True when the browser can drive an animation from the scroll position (`animation-timeline: view()`), so no script is needed. */
export const supportsViewTimeline = (): boolean =>
    typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("animation-timeline: view()")

/** True when the reader asked the system for less motion: nothing slides, loops or counts, and the content stands as it is. */
export const prefersReducedMotion = (): boolean =>
    typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
