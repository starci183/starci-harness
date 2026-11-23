"use client"

import { ArchiveBoxIcon, CloudArrowUpIcon, DocumentIcon, DocumentTextIcon, FilmIcon, MusicalNoteIcon, PhotoIcon, TableCellsIcon } from "@heroicons/react/24/outline"
import { useId, type ReactNode } from "react"
import { Button } from "../../leaf/Button/index.js"
import { Icon, type IconSource } from "../../leaf/Icon/index.js"
import { InlineStatus } from "../../leaf/InlineStatus/index.js"
import { Progress } from "../../leaf/Progress/index.js"
import { Skeleton } from "../../leaf/Skeleton/index.js"
import { Text } from "../../leaf/Text/index.js"
import { TextAction } from "../../leaf/TextAction/index.js"
import type { MarkState } from "../../statusMark.js"
import { fileKindOf, type DropzoneFileKind, type DropzoneRejection } from "./files.js"
import type { DropzoneLabels, DropzoneStatusCounts } from "./labels.js"

/** The upload state of one file, driven by the app: waiting in the queue, uploading (with `progress`), done, or failed. */
export type DropzoneItemStatus = "waiting" | "uploading" | "done" | "error"

/** One file in the list under the zone. The app owns the queue: it adds an item for each file it takes and moves its status. */
export type DropzoneItem = {
    /** Stable across renders: the retry hands it back. */
    readonly id: string
    /** The name shown, usually the relative path (`photos/a.jpg`). */
    readonly name: string
    /** The MIME type, when known; it picks the file-type icon with the name's extension. */
    readonly type?: string
    readonly status: DropzoneItemStatus
    /** 0 to 100 while uploading; a failed row keeps the bar where it stopped. */
    readonly progress?: number
}

/** The look of the zone: idle, something dragged over it, or the last drop refused. */
export type DropzonePhase = "idle" | "over" | "rejected"

const KIND_ICON: Readonly<Record<DropzoneFileKind, IconSource>> = {
    image: PhotoIcon, video: FilmIcon, audio: MusicalNoteIcon, pdf: DocumentTextIcon, sheet: TableCellsIcon, archive: ArchiveBoxIcon, text: DocumentTextIcon, file: DocumentIcon,
}

const MARK_OF_STATUS: Readonly<Record<DropzoneItemStatus, MarkState>> = { waiting: "waiting", uploading: "running", done: "done", error: "error" }

const clampPercent = (value: number | undefined): number => Math.round(Math.min(100, Math.max(0, Number.isFinite(value) ? (value ?? 0) : 0)))

/** The bar of a row: full when done, empty while waiting, where it is while uploading or where it stopped on a failure. */
export const progressOfItem = (item: DropzoneItem): number => (item.status === "done" ? 100 : item.status === "waiting" ? 0 : clampPercent(item.progress))

/** The status words of a row. */
export const statusLabelOf = (item: DropzoneItem, labels: DropzoneLabels): string => {
    if (item.status === "done") return labels.done
    if (item.status === "waiting") return labels.waiting
    if (item.status === "error") return labels.error
    return labels.uploading(clampPercent(item.progress))
}

export const countStatuses = (items: readonly DropzoneItem[]): DropzoneStatusCounts => ({
    done: items.filter((item) => item.status === "done").length,
    uploading: items.filter((item) => item.status === "uploading").length,
    waiting: items.filter((item) => item.status === "waiting").length,
    error: items.filter((item) => item.status === "error").length,
})

type Limits = { readonly maxSize: string | undefined; readonly maxFiles: number | undefined }

/** The words a screen reader hears now: the drag-over title, the refusal, or the summary of the list. */
export const announcementOf = (state: { readonly phase: DropzonePhase; readonly target: string | undefined; readonly draggedCount: number; readonly rejections: readonly DropzoneRejection[]; readonly items: readonly DropzoneItem[] }, labels: DropzoneLabels, limits: Limits): string => {
    if (state.phase === "over") return `${labels.dropTo(state.target)}. ${labels.dragged(state.draggedCount)}`
    if (state.phase === "rejected") return [labels.rejectedTitle, ...state.rejections.map(({ reason, count }) => labels.rejected(reason, count, limits))].join(" ")
    return state.items.length === 0 ? "" : labels.summary(countStatuses(state.items))
}

const DropzoneRow = ({ item, labels, onRetry }: { readonly item: DropzoneItem; readonly labels: DropzoneLabels; readonly onRetry: ((id: string) => void) | undefined }) => (
    <li className="starci-core-dropzone-row" data-grammar-upload-status={item.status}>
        <Icon source={KIND_ICON[fileKindOf(item.name, item.type)]} usage="chip" />
        <div className="starci-core-dropzone-row-main">
            <Text role="body" overflow="truncate">{item.name}</Text>
            <Progress label={labels.progressOf(item.name)} value={progressOfItem(item)} tone="info" />
        </div>
        <div className="starci-core-dropzone-row-status">
            <Text as="span" role="caption"><InlineStatus state={MARK_OF_STATUS[item.status]} label={statusLabelOf(item, labels)} /></Text>
            {item.status === "error" && onRetry !== undefined ? <TextAction size="xs" onPress={() => onRetry(item.id)}>{labels.retry}</TextAction> : null}
        </div>
    </li>
)

export type DropzoneViewProps = {
    readonly phase: DropzonePhase
    readonly labels: DropzoneLabels
    readonly target: string | undefined
    readonly acceptedTypes: readonly string[]
    readonly limits: Limits
    readonly draggedCount: number
    readonly rejections: readonly DropzoneRejection[]
    readonly items: readonly DropzoneItem[]
    readonly folders: boolean
    readonly isDisabled: boolean
    readonly onRetry: ((id: string) => void) | undefined
    readonly onChooseFiles: () => void
    readonly onChooseFolder: () => void
    /** The drop target's handlers and ref from react-dropzone (`getRootProps`), spread on the zone. */
    readonly zoneProps?: Readonly<Record<string, unknown>>
    /** The hidden file input from react-dropzone (`getInputProps`). */
    readonly input?: ReactNode
}

/**
 * The drawing of the upload zone in each state, with no library: the zone (a 1px dashed edge, no shadow), its words and buttons, the
 * status a screen reader hears, and the list of the app's uploads. `DropzoneZone` wires react-dropzone's handlers onto it.
 */
export const DropzoneView = ({ phase, labels, target, acceptedTypes, limits, draggedCount, rejections, items, folders, isDisabled, onRetry, onChooseFiles, onChooseFolder, zoneProps, input }: DropzoneViewProps) => {
    const id = useId().replaceAll(":", "")
    const titleId = `${id}-title`
    const detailId = `${id}-detail`
    const title = phase === "over" ? labels.dropTo(target) : phase === "rejected" ? labels.rejectedTitle : labels.title
    return (
        <div data-tier="ext" data-component="Dropzone" data-contract="A11Y-1 FEEDBACK-1 FOCUS-5" className="starci-core-dropzone">
            <div
                {...zoneProps}
                className="starci-core-dropzone-zone"
                data-grammar-dropzone-state={phase}
                data-disabled={isDisabled ? "true" : undefined}
                role="group"
                aria-labelledby={titleId}
                aria-describedby={detailId}
                aria-disabled={isDisabled ? true : undefined}
            >
                {input}
                <Icon source={CloudArrowUpIcon} usage="leading" />
                <Text id={titleId} role="label.item">{title}</Text>
                <div id={detailId} className="starci-core-dropzone-detail">
                    {phase === "over" ? <Text role="caption">{labels.dragged(draggedCount)}</Text> : null}
                    {phase === "rejected" ? rejections.map(({ reason, count }) => <Text key={reason} role="body">{labels.rejected(reason, count, limits)}</Text>) : null}
                    {phase === "idle" ? <Text role="caption">{labels.acceptedTypes(acceptedTypes, limits.maxSize)}</Text> : null}
                </div>
                {phase === "over" ? null : (
                    <div className="starci-core-dropzone-actions">
                        <Button variant="border" isDisabled={isDisabled} onPress={onChooseFiles}>{labels.chooseFiles}</Button>
                        {folders ? <Button variant="border" isDisabled={isDisabled} onPress={onChooseFolder}>{labels.chooseFolder}</Button> : null}
                    </div>
                )}
            </div>
            <span className="starci-core-visually-hidden" role="status" aria-live="polite" data-grammar-dropzone-announce="true">
                {announcementOf({ phase, target, draggedCount, rejections, items }, labels, limits)}
            </span>
            {items.length === 0 ? null : (
                <ul className="starci-core-dropzone-list" aria-label={labels.listLabel}>
                    {items.map((item) => <DropzoneRow key={item.id} item={item} labels={labels} onRetry={onRetry} />)}
                </ul>
            )}
        </div>
    )
}

/** The zone and its rows as Skeletons, at the ready box: the first read has nothing to show yet, or react-dropzone is still loading. */
export const DropzoneSkeleton = ({ rows }: { readonly rows: number }) => (
    <div data-tier="ext" data-component="Dropzone" data-loading="true" aria-busy="true" className="starci-core-dropzone">
        <Skeleton shape="box" width="100%" height="var(--starci-core-dropzone-height)" />
        {rows === 0 ? null : (
            <div className="starci-core-dropzone-list" aria-hidden="true">
                {Array.from({ length: rows }, (_, index) => (
                    <div key={index} className="starci-core-dropzone-row">
                        <Icon source={DocumentIcon} usage="chip" isLoading />
                        <div className="starci-core-dropzone-row-main"><Skeleton shape="text" /><Progress label="" isLoading /></div>
                        <div className="starci-core-dropzone-row-status"><Skeleton shape="text" /></div>
                    </div>
                ))}
            </div>
        )}
    </div>
)
