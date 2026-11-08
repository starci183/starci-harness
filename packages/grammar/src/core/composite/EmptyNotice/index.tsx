import type { ReactNode } from "react"
import type { ButtonIntent } from "../../buttonIntent.js"
import { Button } from "../../leaf/Button/index.js"
import { IconTile } from "../../leaf/IconTile/index.js"
import type { IconSource } from "../../leaf/Icon/index.js"
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
        /** Optional app-owned glyph for the empty condition. */
        readonly iconSource?: IconSource
        readonly artwork?: undefined
    }
    | {
        readonly iconSource?: undefined
        /** The first-run notice's character art (empty-state.choose.cause:first-run). */
        readonly artwork: EmptyNoticeArtwork
    }

export type EmptyNoticeProps = NoChildren & EmptyNoticeMark & {
    readonly message: string
    readonly description?: string
    readonly actionLabel?: string
    /**
     * The action's weight. `commit` (default) is the region's one primary; `neutral` is the outlined button, for an empty
     * notice in a secondary place (a rail, a side card) on a page whose primary already stands in its header.
     */
    readonly actionIntent?: Extract<ButtonIntent, "commit" | "neutral">
    readonly actionStartContent?: ReactNode
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
        data-grammar-empty-mark={artwork !== undefined ? "artwork" : iconSource !== undefined ? "glyph" : "none"}
        className="starci-core-empty-notice"
    >
        {artwork === undefined ? null : <Mascot size="md" {...artwork} />}
        {iconSource === undefined ? null : <IconTile source={iconSource} tone="neutral" size="md" />}
        <div className="starci-core-notice-copy" data-contract="GAP-1">
            <Text size="sm" isStrong>{message}</Text>
            {description === undefined ? null : <Text size="sm" tone="muted">{description}</Text>}
        </div>
        {actionLabel === undefined ? null : (
            <Button
                intent={actionIntent}
                size="sm"
                startContent={actionStartContent}
                isPending={isActionPending}
                {...(onAction === undefined ? {} : { onPress: onAction })}
            >
                {actionLabel}
            </Button>
        )}
    </div>
)
