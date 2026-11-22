"use client"

/**
 * `@starci/grammar/core/ext/dropzone`: the upload extension of the core grammar. An app takes EVERY upload with its `Dropzone`, never with
 * `react-dropzone` imported directly (DNA-COMMON-NO-GRAPH-OR-MOTION-LIBRARY). It imports core's components and tokens; core never imports it.
 * `react-dropzone` is an optional peer dependency, loaded lazily with the zone: install it only in an app that uploads.
 */
export { Dropzone, type DropzoneProps } from "./Dropzone.js"
export type { DropzoneItem, DropzoneItemStatus, DropzonePhase } from "./DropzoneView.js"
export { DEFAULT_DROPZONE_LABELS, resolveDropzoneLabels, type DropzoneLabels, type DropzoneStatusCounts } from "./labels.js"
export {
    acceptedTypesOf,
    fileKindOf,
    flattenEntries,
    formatBytes,
    rejectionsOf,
    relativePathOf,
    type DropEntry,
    type DropzoneAccept,
    type DropzoneFile,
    type DropzoneFileKind,
    type DropzoneRejectReason,
    type DropzoneRejection,
} from "./files.js"
