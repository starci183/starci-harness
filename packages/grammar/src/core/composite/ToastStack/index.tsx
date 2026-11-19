"use client"

import { ToastProvider as HeroToastProvider, toast as heroToast, type HeroUIToastOptions } from "@heroui/react"
import type { PresentationState } from "../../../common/state.js"
import type { NoChildren } from "../../tier.js"

/** The one action a stacked toast may carry: its words and what it does (the toast closes after it runs). */
export type ToastStackAction = {
    readonly label: string
    readonly onAction: () => void
}

export type ToastStackOptions = {
    readonly title: string
    /** One short sentence under the title. */
    readonly description?: string
    /** A quiet fact joined to the description after a middle dot (a duration, a time). */
    readonly meta?: string
    /** Render-neutral meaning: `pending` draws a spinner and stays until it is updated; `negative` and a toast with an action stay until dismissed. Default `neutral`. */
    readonly tone?: PresentationState
    readonly action?: ToastStackAction
    /** Milliseconds before auto-dismiss; `0` keeps the toast until dismissed. */
    readonly timeout?: number
}

/** How long a toast that carries no decision stays (WCAG 2.2.1: a toast with an action, a pending one and a negative one persist). */
export const TOAST_STACK_TIMEOUT = 5000

type Variant = NonNullable<HeroUIToastOptions["variant"]>

const VARIANT_OF: Readonly<Record<PresentationState, Variant>> = {
    neutral: "default",
    informative: "accent",
    affirmative: "success",
    cautionary: "warning",
    negative: "danger",
    pending: "default",
    unavailable: "default",
}

const timeoutOf = (options: ToastStackOptions): number => {
    if (options.timeout !== undefined) return Math.max(0, options.timeout)
    if (options.action !== undefined || options.tone === "negative" || options.tone === "pending") return 0
    return TOAST_STACK_TIMEOUT
}

const optionsOf = (options: ToastStackOptions): HeroUIToastOptions => {
    const tone = options.tone ?? "neutral"
    const description = [options.description, options.meta].filter((part): part is string => part !== undefined && part !== "").join(" · ")
    const action = options.action
    return {
        variant: VARIANT_OF[tone],
        isLoading: tone === "pending",
        timeout: timeoutOf(options),
        ...(description === "" ? {} : { description }),
        ...(action === undefined ? {} : { actionProps: { children: action.label, onPress: action.onAction } }),
    }
}

/**
 * The stacked toasts, drawn by HeroUI's Toast: `show` adds one and answers its id, `update` turns that same toast into another (a pending
 * check becomes its result, so one act is one toast), `dismiss` closes one. Mount exactly one `ToastStack` inside the root.
 */
export const stackToast = {
    show: (options: ToastStackOptions): string => heroToast(options.title, optionsOf(options)),
    update: (id: string, options: ToastStackOptions): void => {
        heroToast.update(id, options.title, optionsOf(options))
    },
    dismiss: (id: string): void => {
        heroToast.close(id)
    },
    clear: (): void => {
        heroToast.clear()
    },
} as const

export type ToastStackPlacement = "top" | "top end" | "top start" | "bottom" | "bottom end" | "bottom start"

export type ToastStackProps = NoChildren & {
    /** Default `bottom end`. */
    readonly placement?: ToastStackPlacement
    /** How many toasts are drawn at once; the rest wait behind. Default 3. */
    readonly maxVisible?: number
}

/**
 * COMPOSITE - `ToastStack`: the region HeroUI's Toast draws into (white card, status icon, title, description, one action, close).
 * Mount it ONCE inside the app's `GrammarRoot`; add toasts with `stackToast`.
 * Contract: region LAYOUT-4 (fixed); announcements are HeroUI's live region (FEEDBACK-3).
 */
export const ToastStack = ({ placement = "bottom end", maxVisible = 3 }: ToastStackProps) => (
    <div data-tier="composite" data-component="ToastStack" data-placement={placement} data-contract="LAYOUT-4 FEEDBACK-3">
        <HeroToastProvider placement={placement} maxVisibleToasts={maxVisible} />
    </div>
)
