"use client"

import { lazy, Suspense } from "react"
import { useIsLoading } from "../../regionScope.js"
import type { NoChildren } from "../../tier.js"
import type { DropzoneAccept, DropzoneFile } from "./files.js"
import type { DropzoneLabels } from "./labels.js"
import { DropzoneSkeleton, type DropzoneItem } from "./DropzoneView.js"

/** react-dropzone loads with the zone, never with the page: an app that shows no upload never fetches it. */
const DropzoneZone = lazy(() => import("./DropzoneZone.js"))

export type DropzoneProps = NoChildren & {
    /** The accepted types, a MIME type to its extensions: `{ "image/*": [".png", ".jpg"], "application/pdf": [".pdf"] }`. Omitted, any file. */
    readonly accept?: DropzoneAccept
    /** The largest file accepted, in bytes; a bigger one is refused as too big. */
    readonly maxSize?: number
    /** The most files one drop or pick takes; more refuses the whole drop as too many. */
    readonly maxFiles?: number
    /** More than one file at a time. Default true; false takes one file and hides the folder button. */
    readonly multiple?: boolean
    /** Offer the folder picker beside the file picker (a dragged folder is always walked). Default true. */
    readonly folders?: boolean
    /** The accepted files of one drop or pick, each with its path relative to what was dropped (`photos/2026/a.jpg`). */
    readonly onFiles: (files: DropzoneFile[]) => void
    /** Where the files go, in the drag-over title ("Drop to upload to <target>"): a folder, a record, a channel. */
    readonly target?: string
    /** The uploads the app is running, one row each; the app moves their status and progress. */
    readonly items?: readonly DropzoneItem[]
    /** A failed row's retry, with the item's id. Without it a failed row shows no retry. */
    readonly onRetry?: (id: string) => void
    /** The words, in the app's language; every word left out keeps its English default. */
    readonly labels?: Partial<DropzoneLabels>
    readonly isDisabled?: boolean
    /** The first read has nothing to show yet: the zone and its rows as Skeletons. Inside a loading region it follows the region. */
    readonly isLoading?: boolean
}

/**
 * EXT - `Dropzone`: the one upload of the core grammar (`@starci/grammar/core/ext/dropzone`). A zone with a 1px dashed edge that takes
 * files and folders by drag and drop or by its pickers, says in words why a drop was refused (too big, wrong type, too many), and lists
 * the app's uploads with a file-type icon, an info Progress bar and an inline status. Keyboard: the zone is a tab stop, Enter or Space
 * opens the picker. Contract: A11Y-1 (named, reachable), FEEDBACK-1 (every state answers in words, announced politely), FOCUS-5.
 */
export const Dropzone = ({ isLoading: own, ...props }: DropzoneProps) => {
    const isLoading = useIsLoading(own)
    const skeleton = <DropzoneSkeleton rows={props.items?.length ?? 0} />
    if (isLoading) return skeleton
    return (
        <Suspense fallback={skeleton}>
            <DropzoneZone {...props} />
        </Suspense>
    )
}
