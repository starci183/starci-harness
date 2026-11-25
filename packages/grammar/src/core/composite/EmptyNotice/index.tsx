"use client"

import type { ReactNode } from "react"
import { Button } from "../../leaf/Button/index.js"
import { Link } from "../../leaf/Link/index.js"
import { IconTile } from "../../leaf/IconTile/index.js"
import type { IconSource } from "../../leaf/Icon/index.js"
import { glyphSource } from "../../leaf/Icon/glyphs.js"
import { Illustration, type IllustrationCompact } from "../../leaf/Illustration/index.js"
import type { AssetSlotProps, MediaSourceRef } from "../../leaf/Image/index.js"
import { Text } from "../../leaf/Text/index.js"
import { ErrorView } from "../../loadingState.js"
import { StepMark } from "../../StepMark.js"
import { useSurfaceHost } from "../../surfaceContext.js"
import type { NoChildren } from "../../tier.js"

/**
 * The picture of a page-level state (a first visit, an empty page, a paywall, a 404, a 500): decorative art the app delivers
 * as a statics key (or a resolved `src`), drawn by `Illustration` at the state step: 160px, 120px below 48rem. It is
 * decorative (`aria-hidden`): the title says the state.
 */
export type EmptyNoticeIllustration = MediaSourceRef & AssetSlotProps & {
    /** Another crop below 48rem, when the wide art does not survive a phone. */
    readonly compact?: IllustrationCompact
    readonly loading?: "lazy" | "eager"
}

/** The icon of an in-page state: a glyph in a soft brand-tone circle. */
type EmptyNoticeIcon = { readonly icon: IconSource; readonly illustration?: never }

/**
 * The notice's one mark, by the scope of the state. A `region` (the default) is a state inside a page (an empty Section, a list or a
 * table, a no-match after a filter, a panel): its mark is an `icon` and never art, so a working page carries no picture (DISCIPLINE-3). A
 * `page` is the whole page's state: its mark is an `illustration`, or an `icon` when the app has no art. The type refuses
 * `illustration` on a region, so the rule is held by the compiler.
 */
type EmptyNoticeMedia =
    | {
        readonly scope?: "region"
        /** `icon` (default): the glyph tile over the words. `none` (0.48.0) is the plain line, see `EmptyNoticeLine`. */
        readonly mark?: "icon"
        /** The glyph of the condition; without one the notice wears Grammar's `empty` glyph, so a notice is never bare words. */
        readonly media?: EmptyNoticeIcon
    }
    | EmptyNoticeLine
    | {
        readonly scope: "page"
        /** A page-level state always wears its mark: the plain line is a region's. */
        readonly mark?: "icon"
        readonly media?: EmptyNoticeIcon | { readonly illustration: EmptyNoticeIllustration; readonly icon?: never }
    }

/**
 * THE PLAIN LINE (0.48.0, the illustration rule): a no-match after a filter or a search, an empty panel, a palette with no result, an empty sub-section.
 * No tile and no picture: one muted 14 line (and its optional hint) at the start edge of the region, the action, if any, a small button after it.
 * Only on a region; the type refuses `media` with it, and a page-level state keeps its mark.
 */
type EmptyNoticeLine = {
    readonly scope?: "region"
    readonly mark: "none"
    readonly media?: never
}

/** The one secondary action: a destination or a command, text only, never a second primary. */
export type EmptyNoticeSecondary = { readonly label: string } & (
    | { readonly href: string; readonly onPress?: never }
    | { readonly onPress: () => void; readonly href?: never }
)

/** The action's look and its start icon: only the primary action (`primary`, the default) may carry one (the button-icon rule). */
type EmptyNoticeAction =
    | {
        /** `primary` (default) is the region's one primary. */
        readonly actionVariant?: "primary"
        /** What the action does, at its start. Primary only. Not with `actionEndArrow` (a Button does something or leads somewhere, never both). */
        readonly actionStartContent?: ReactNode
    }
    | {
        /** `border` is the outlined button, for an empty notice in a secondary place (a rail, a side card) on a page whose primary already stands in its header. Text only. */
        readonly actionVariant: "border"
        readonly actionStartContent?: never
    }

/** One numbered step of a first-run notice (0.46.2). */
export type EmptyNoticeStep = {
    readonly id: string
    /** What to do, in a few words ("Connect your Google Drive"). */
    readonly label: string
    /** One muted line under the label. */
    readonly description?: string
    /** The step is finished: it draws a check in place of its number. */
    readonly isDone?: boolean
}

/** A first-run notice holds two to five steps. */
const EMPTY_NOTICE_MIN_STEPS = 2
const EMPTY_NOTICE_MAX_STEPS = 5

type EmptyNoticeBase = NoChildren & {
    readonly message: string
    readonly description?: string
    /**
     * `frameless` (default since 0.37.4): no border, background or shadow, a notice that is words on the ground of the pane or well it stands on
     * (`data-grammar-empty-frame="none"`). `card` is opt-in: one surface card, for a notice that is itself the content of a page.
     */
    readonly frame?: "card" | "frameless"
}

/**
 * The good-news state (0.46.2): a region that is empty because nothing needs the reader ("All caught up", "No approvals waiting"). It wears a success mark, says it in the title and
 * the description, and has no action: there is nothing to do, so every action prop, `steps`, `media` and `isError` are refused by the type.
 */
type EmptyNoticeAllClear = {
    readonly isAllClear: true
    readonly scope?: "region"
    readonly mark?: never
    readonly media?: never
    readonly actionVariant?: never
    readonly actionStartContent?: never
    readonly actionLabel?: never
    readonly actionHref?: never
    readonly actionEndArrow?: never
    readonly isActionPending?: never
    readonly onAction?: never
    readonly secondary?: never
    readonly steps?: never
    readonly isError?: never
}

type EmptyNoticeRegular = EmptyNoticeMedia & EmptyNoticeAction & {
    readonly isAllClear?: false
    /**
     * A first-run notice with numbered steps (0.46.2), two to five (a development error otherwise): the steps stand as a numbered list under the description, a finished step wears a
     * check, and the FIRST OPEN step carries the notice's one primary action (`actionLabel` with `onAction` or `actionHref`), drawn under that step's words, so the way in is always one
     * press. Later open steps are grey numbers; a notice whose steps are all done draws its action where a plain notice does. `secondary` stays at the foot.
     */
    readonly steps?: ReadonlyArray<EmptyNoticeStep>
    readonly actionLabel?: string
    /**
     * A navigation action (0.36.2): the notice ends in a `Link variant="head"` ("Back to overview" then an arrow that slides on hover) to this destination instead of a Button.
     * Navigation is a link; a command (`onAction`) stays a Button. Takes `actionLabel` as its label; not with `onAction`.
     */
    readonly actionHref?: string
    /** The action leads somewhere (opens the place where the first item is made): the button ends with Grammar's arrow. */
    readonly actionEndArrow?: boolean
    readonly isActionPending?: boolean
    readonly onAction?: () => void
    /** At most one secondary action beside the primary (a page-level state's "Try again" beside "Back home"). */
    readonly secondary?: EmptyNoticeSecondary
    /** The read failed: the notice is a live alert with a warning mark, so a failure never reads as empty. The mark props are ignored. */
    readonly isError?: boolean
}

export type EmptyNoticeProps = EmptyNoticeBase & (EmptyNoticeRegular | EmptyNoticeAllClear)

/**
 * The one empty state of the Grammar: a centred stack of media, title, description and actions (one primary and at most one
 * secondary). Settled answer for a region with nothing, a page that has never held content, a no-match, or a page-level
 * failure. `scope="page"` takes an illustration; every in-page state takes an icon.
 */
export const EmptyNotice = ({
    message,
    description,
    scope = "region",
    mark = "icon",
    media,
    secondary,
    actionLabel,
    actionHref,
    actionVariant = "primary",
    actionStartContent,
    actionEndArrow = false,
    isActionPending = false,
    onAction,
    isError = false,
    frame = "frameless",
    steps,
    isAllClear = false,
}: EmptyNoticeProps) => {
    if (steps !== undefined && process.env.NODE_ENV !== "production" && (steps.length < EMPTY_NOTICE_MIN_STEPS || steps.length > EMPTY_NOTICE_MAX_STEPS)) {
        throw new Error(`EmptyNotice steps holds ${EMPTY_NOTICE_MIN_STEPS} to ${EMPTY_NOTICE_MAX_STEPS} steps; this one has ${steps.length}.`)
    }
    const openIndex = steps?.findIndex((step) => step.isDone !== true) ?? -1
    // Inside a card the card is the frame (0.36.2): the notice is words, never a second framed box.
    const inCard = useSurfaceHost() === "card"
    const framed = frame === "card" && !inCard
    const primary = actionLabel === undefined ? null : actionHref !== undefined && scope === "page" ? (
        <Button size="md" variant={actionVariant} href={actionHref}>{actionLabel}</Button>
    ) : actionHref !== undefined ? (
        <span className="starci-core-notice-link" data-grammar-notice-link="true"><Link variant="head" href={actionHref}>{actionLabel}</Link></span>
    ) : (
        <Button
            {...(actionEndArrow ? { size: "md" as const, variant: actionVariant, endArrow: true as const } : actionVariant === "primary" && actionStartContent !== undefined ? { size: "md" as const, variant: actionVariant, startContent: actionStartContent } : { size: "md" as const, variant: actionVariant })}
            isPending={isActionPending}
            {...(onAction === undefined ? {} : { onPress: onAction })}
        >
            {actionLabel}
        </Button>
    )
    // With steps the primary stands under the first open step; with none open (or no steps) it stands in the actions row.
    const primaryInStep = steps !== undefined && openIndex >= 0
    const isLine = mark === "none" && !isAllClear && scope === "region"
    return isError ? (
    <ErrorView error={{ message, ...(description === undefined ? {} : { description }), ...(actionLabel === undefined ? {} : { actionLabel }), ...(onAction === undefined ? {} : { onAction }), ...(secondary?.href === undefined ? {} : { back: { label: secondary.label, href: secondary.href } }), ...(scope === "page" ? { scope: "page" as const } : {}) }} />
) : (
    <div
        data-tier="composite"
        data-component="EmptyNotice"
        data-contract="GAP-3 PADDING-4"
        data-grammar-empty-scope={scope}
        data-grammar-empty-mark={isAllClear ? "success" : isLine ? "none" : media?.illustration === undefined ? "icon" : "illustration"}
        {...(isAllClear ? { "data-grammar-empty-kind": "all-clear" } : steps === undefined ? {} : { "data-grammar-empty-kind": "steps" })}
        {...(framed ? {} : { "data-grammar-empty-frame": "none" })}
        className="starci-core-empty-notice"
    >
        {isLine ? null : isAllClear ? <IconTile state="done" /> : media?.illustration === undefined ? <IconTile source={media?.icon ?? glyphSource("empty")} tone="accent" /> : <span className="starci-core-notice-art" data-grammar-notice-art="true"><Illustration {...media.illustration} ratio="1:1" fit="contain" /></span>}
        <div className="starci-core-notice-copy" data-contract="GAP-1">
            <Text {...(isLine ? { role: "body" as const, tone: "muted" as const } : { role: "label.item" as const })}>{message}</Text>
            {description === undefined ? null : <Text role="body" tone="muted">{description}</Text>}
        </div>
        {steps === undefined ? null : (
            <ol className="starci-core-notice-steps" data-grammar-notice-steps="true">
                {steps.map((step, index) => {
                    const state = step.isDone === true ? "done" : index === openIndex ? "current" : "todo"
                    return (
                        <li key={step.id} className="starci-core-notice-step" data-grammar-step-state={state} {...(state === "current" ? { "aria-current": "step" as const } : {})}>
                            <StepMark state={state} position={index + 1} />
                            <span className="starci-core-notice-step-body">
                                <Text role={state === "current" ? "label.item" : "body"}>{step.label}</Text>
                                {step.description === undefined ? null : <Text role="body" tone="muted">{step.description}</Text>}
                                {state === "current" && primaryInStep ? <span className="starci-core-notice-step-action" data-grammar-notice-actions="true">{primary}</span> : null}
                            </span>
                        </li>
                    )
                })}
            </ol>
        )}
        {(primaryInStep ? false : actionLabel !== undefined) || secondary !== undefined ? (
            <div className="starci-core-notice-actions" data-grammar-notice-actions="true">
                {primaryInStep ? null : primary}
                {secondary === undefined ? null : secondary.href === undefined ? (
                    <Button size="md" variant="border" onPress={secondary.onPress}>{secondary.label}</Button>
                ) : (
                    <Button size="md" variant="border" href={secondary.href}>{secondary.label}</Button>
                )}
            </div>
        ) : null}
    </div>
)
}
