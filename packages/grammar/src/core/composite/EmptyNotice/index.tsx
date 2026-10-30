import type { ReactNode } from "react"
import { Button, type ButtonVariant } from "../../primitive/Button/index.js"
import { IconTile } from "../../primitive/IconTile/index.js"
import type { IconSource } from "../../primitive/Icon/index.js"
import { Mascot, type MascotProps } from "../../primitive/Mascot/index.js"
import { Text } from "../../primitive/Text/index.js"

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

export type EmptyNoticeProps = EmptyNoticeMark & {
    readonly message: string
    readonly description?: string
    readonly actionLabel?: string
    readonly actionStartContent?: ReactNode
    readonly actionVariant?: ButtonVariant
    readonly isActionPending?: boolean
    readonly onAction?: () => void
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
    actionStartContent,
    actionVariant = "primary",
    isActionPending = false,
    onAction,
}: EmptyNoticeProps) => (
    <div
        data-tier="composite"
        data-component="EmptyNotice"
        data-contract="GAP-3 PADDING-4"
        data-grammar-empty-mark={artwork !== undefined ? "artwork" : iconSource !== undefined ? "glyph" : "none"}
        className="starci-core-empty-notice"
    >
        {artwork === undefined ? null : <Mascot size="md" {...artwork} />}
        {iconSource === undefined ? null : <IconTile source={iconSource} tone="neutral" size="md" />}
        <Text size="sm" tone="muted">{message}</Text>
        {description === undefined ? null : <Text size="xs" tone="muted">{description}</Text>}
        {actionLabel === undefined ? null : (
            <Button
                variant={actionVariant}
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
