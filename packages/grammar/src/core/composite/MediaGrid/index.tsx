"use client"

import type { ReactNode } from "react"
import { Badge, type BadgeTone } from "../../leaf/Badge/index.js"
import { Icon } from "../../leaf/Icon/index.js"
import { Image } from "../../leaf/Image/index.js"
import { Link } from "../../leaf/Link/index.js"
import { Skeleton } from "../../leaf/Skeleton/index.js"
import { Text } from "../../leaf/Text/index.js"
import { Video, type VideoLabels } from "../../leaf/Video/index.js"
import type { VideoSourceType } from "../../leaf/Video/playback.js"
import { FILE_GLYPHS, type FileKind } from "../../fileGlyph.js"
import { useIsLoading, useRegionOwnsBusy } from "../../regionScope.js"
import type { NoChildren } from "../../tier.js"

export type { FileKind } from "../../fileGlyph.js"

/** How the files stand: tiles of previews in a grid, or one hairline row per file. */
export type MediaGridLayout = "grid" | "list"

/** Where a file is used: the record it belongs to, in the app's words, as a link back to it. */
export type MediaItemSource = {
    readonly label: string
    readonly href: string
    readonly onFollow?: () => void
}

/** One file the grid draws. */
export type MediaItem = {
    readonly id: string
    readonly kind: FileKind
    /** The file's name, as the person knows it. */
    readonly name: string
    /** A short-lived address of the file for the preview; null draws the glyph of its kind (a file that cannot be previewed, or no address yet). */
    readonly src: string | null
    /** The type the server stored (`video/mp4`), so a video plays only from a source the browser can read. */
    readonly mime?: string
    /** A poster for a video (its first frame, when the app has one). */
    readonly poster?: string
    /** One line of facts in the app's format: size, dimensions, duration. */
    readonly meta?: string
    /** The record the file is used by; a file used by several shows the first and says how many in `meta`. */
    readonly source?: MediaItemSource
    /** One quiet mark of a real state of the file (used nowhere, kept until a date), in the app's words. */
    readonly badge?: { readonly label: string; readonly tone?: BadgeTone }
}

export type MediaGridProps = NoChildren & {
    /** Names the collection for assistive technology ("Ảnh của Sản phẩm"). */
    readonly label: string
    readonly items: readonly MediaItem[]
    /** Default `grid`. */
    readonly layout?: MediaGridLayout
    /** The file whose detail is open: its tile or row is drawn selected. */
    readonly selectedId?: string
    /** Opens a file's detail (the app's drawer). The file's name is the button. */
    readonly onOpen?: (id: string) => void
    /** What shows when there is no file. Required: a grid answers for its empty state. */
    readonly empty: ReactNode
    /** The first read has no files yet: tiles or rows of the size of the loaded ones. */
    readonly isLoading?: boolean
    /** The words a video says when it cannot play, in the app's language. */
    readonly videoLabels?: VideoLabels
}

const PLAYABLE: ReadonlySet<string> = new Set<VideoSourceType>(["video/mp4", "video/webm", "video/ogg"])
const LOADING_TILES = 6

/** The type a video plays from: the stored one when the browser reads it, else MP4 (a QuickTime file is an MP4 container the browser mostly plays). */
const videoTypeOf = (mime: string | undefined): VideoSourceType => (mime !== undefined && PLAYABLE.has(mime) ? (mime as VideoSourceType) : "video/mp4")

/** The plate of a file with no preview: the glyph of its kind, centred. */
const Plate = ({ kind }: { readonly kind: FileKind }) => (
    <span className="starci-core-media-grid-plate" aria-hidden="true">
        <Icon source={FILE_GLYPHS[kind]} usage="text" />
    </span>
)

/** The preview of a tile: the picture, the playable video, the player of a sound under its plate, or the plate of the kind. */
const Preview = ({ item, videoLabels }: { readonly item: MediaItem; readonly videoLabels: VideoLabels | undefined }) => {
    if (item.src === null) return <Plate kind={item.kind} />
    if (item.kind === "image") return <Image src={item.src} alt={item.name} ratio="1:1" fit="cover" />
    if (item.kind === "video") {
        return (
            <Video
                title={item.name}
                sources={[{ src: item.src, type: videoTypeOf(item.mime) }]}
                ratio="1:1"
                {...(item.poster === undefined ? {} : { poster: { src: item.poster } })}
                {...(videoLabels === undefined ? {} : { labels: videoLabels })}
            />
        )
    }
    if (item.kind === "audio") {
        return (
            <span className="starci-core-media-grid-audio">
                <Plate kind="audio" />
                <audio className="starci-core-media-grid-player" controls preload="none" src={item.src} aria-label={item.name} />
            </span>
        )
    }
    return <Plate kind={item.kind} />
}

/** The words of a file: its name (the button that opens it), its facts and the record it is used by. */
const Words = ({ item, onOpen }: { readonly item: MediaItem; readonly onOpen: ((id: string) => void) | undefined }) => (
    <span className="starci-core-media-grid-words">
        {onOpen === undefined ? (
            <Text as="span" role="label.item" overflow="truncate">{item.name}</Text>
        ) : (
            <button type="button" className="starci-core-media-grid-open" title={item.name} onClick={() => { onOpen(item.id) }}>
                <Text as="span" role="label.item" overflow="truncate">{item.name}</Text>
            </button>
        )}
        {item.meta === undefined ? null : <Text as="span" role="caption" overflow="truncate">{item.meta}</Text>}
        {item.source === undefined ? null : (
            <span className="starci-core-media-grid-source">
                <Link href={item.source.href} variant="plain" {...(item.source.onFollow === undefined ? {} : { onFollow: item.source.onFollow })}>{item.source.label}</Link>
            </span>
        )}
        {item.badge === undefined ? null : <span className="starci-core-media-grid-badge"><Badge tone={item.badge.tone ?? "neutral"}>{item.badge.label}</Badge></span>}
    </span>
)

/**
 * The files of a collection: in a grid, a square preview per file (the picture, the video that plays in place, a sound's player, the glyph of a document) with its
 * name, one line of facts and a link to the record it is used by; in a list, one hairline row per file with a small preview. The name opens the file's detail
 * (`onOpen`); the preview stays the media's own control, so a video plays where it stands. No card in a card: tiles sit on the surface they are drawn on, with the
 * Grammar's one radius on the preview only. Loading draws tiles or rows of the loaded size; no file draws `empty`.
 */
export const MediaGrid = ({ label, items, layout = "grid", selectedId, onOpen, empty, isLoading: ownLoading, videoLabels }: MediaGridProps) => {
    const isLoading = useIsLoading(ownLoading)
    const ownsBusy = useRegionOwnsBusy()
    if (!isLoading && items.length === 0) return <>{empty}</>
    if (isLoading) {
        return (
            <ul className="starci-core-media-grid" data-component="MediaGrid" data-tier="composite" data-grammar-media-layout={layout} aria-label={label} aria-busy={ownsBusy ? undefined : true}>
                {Array.from({ length: LOADING_TILES }, (_, index) => (
                    <li key={index} className="starci-core-media-grid-item" aria-hidden="true">
                        <span className="starci-core-media-grid-preview"><Skeleton shape="rect" /></span>
                        <span className="starci-core-media-grid-words"><Skeleton shape="text" lines={2} /></span>
                    </li>
                ))}
            </ul>
        )
    }
    return (
        <ul className="starci-core-media-grid" data-component="MediaGrid" data-tier="composite" data-grammar-media-layout={layout} aria-label={label}>
            {items.map((item) => (
                <li key={item.id} className="starci-core-media-grid-item" data-kind={item.kind} data-selected={item.id === selectedId ? "true" : undefined}>
                    <span className="starci-core-media-grid-preview">
                        {layout === "list" && item.kind !== "image" ? <Plate kind={item.kind} /> : <Preview item={item} videoLabels={videoLabels} />}
                    </span>
                    <Words item={item} onOpen={onOpen} />
                </li>
            ))}
        </ul>
    )
}
