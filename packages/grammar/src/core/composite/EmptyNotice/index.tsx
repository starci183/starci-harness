import type { ReactNode } from "react"
import { Button } from "../../leaf/Button/index.js"
import { IconTile } from "../../leaf/IconTile/index.js"
import type { IconSource } from "../../leaf/Icon/index.js"
import { glyphSource } from "../../leaf/Icon/glyphs.js"
import { Mascot, type MascotProps } from "../../leaf/Mascot/index.js"
import { Text } from "../../leaf/Text/index.js"
import { ErrorView } from "../../loadingState.js"
import type { NoChildren } from "../../tier.js"

/**
 * The art of a first-run notice: generated character art drawn through `Mascot` at the `md` step (the support row of
 * `mascot.choose.size`), tied to its asset slot. The step is the grammar's, so the slot takes the art and its
 * provenance only; `assetSlot` is required, the type holding what lint R338 holds on a written `Mascot`.
 */
export type EmptyNoticeArtwork = Pick<MascotProps, "src" | "alt" | "loading" | "assetSha256" | "assetPrompt"> & {
    readonly assetSlot: string
}

/** The notice's one mark: a glyph for an ordinary empty or failed region, or the first-run artwork, never both. */
type EmptyNoticeMark =
    | {
        /** The app's glyph for the empty condition; without one the notice wears Grammar's `empty` tray, so a notice is never bare words. */
        readonly iconSource?: IconSource
        readonly artwork?: undefined
    }
    | {
        readonly iconSource?: undefined
        /** The first-run notice's character art (empty-state.choose.cause:first-run). */
        readonly artwork: EmptyNoticeArtwork
    }

/** The action's weight and its start icon: only the primary action (`commit`, the default) may carry one (the button-icon rule). */
type EmptyNoticeAction =
    | {
        /** `commit` (default) is the region's one primary. */
        readonly actionIntent?: "commit"
        /** What the action does, at its start. Primary only. Not with `actionEndArrow` (a Button does something or leads somewhere, never both). */
        readonly actionStartContent?: ReactNode
    }
    | {
        /** `neutral` is the outlined button, for an empty notice in a secondary place (a rail, a side card) on a page whose primary already stands in its header. Text only. */
        readonly actionIntent: "neutral"
        readonly actionStartContent?: never
    }

export type EmptyNoticeProps = NoChildren & EmptyNoticeMark & EmptyNoticeAction & {
    readonly message: string
    readonly description?: string
    readonly actionLabel?: string
    /** The action leads somewhere (opens the place where the first item is made): the button ends with Grammar's arrow. */
    readonly actionEndArrow?: boolean
    readonly isActionPending?: boolean
    readonly onAction?: () => void
    /** The read failed: the notice is a live alert with a warning mark, so a failure never reads as empty. The mark props are ignored. */
    readonly isError?: boolean
}

/**
 * Settled empty-region answer with an optional recovery action. Its mark is a glyph, or, on a page that has never
 * held content, the first-run artwork: a `Mascot` at `md` above the message (`data-grammar-empty-mark="artwork"`).
 */
export const EmptyNotice = ({
    message,
    description,
    iconSource,
    artwork,
    actionLabel,
    actionIntent = "commit",
    actionStartContent,
    actionEndArrow = false,
    isActionPending = false,
    onAction,
    isError = false,
}: EmptyNoticeProps) => isError ? (
    <ErrorView error={{ message, ...(description === undefined ? {} : { description }), ...(actionLabel === undefined ? {} : { actionLabel }), ...(onAction === undefined ? {} : { onAction }) }} />
) : (
    <div
        data-tier="composite"
        data-component="EmptyNotice"
        data-contract="GAP-3 PADDING-4"
        data-grammar-empty-mark={artwork === undefined ? "glyph" : "artwork"}
        className="starci-core-empty-notice"
    >
        {artwork === undefined ? null : <Mascot size="md" {...artwork} />}
        {artwork === undefined ? <IconTile source={iconSource ?? glyphSource("empty")} tone="neutral" size="md" /> : null}
        <div className="starci-core-notice-copy" data-contract="GAP-1">
            <Text size="sm" isStrong>{message}</Text>
            {description === undefined ? null : <Text size="sm" tone="muted">{description}</Text>}
        </div>
        {actionLabel === undefined ? null : (
            <Button
                size="sm"
                {...(actionEndArrow ? { intent: actionIntent, endArrow: true as const } : actionIntent === "commit" ? { intent: actionIntent, startContent: actionStartContent } : { intent: actionIntent })}
                isPending={isActionPending}
                {...(onAction === undefined ? {} : { onPress: onAction })}
            >
                {actionLabel}
            </Button>
        )}
    </div>
)
