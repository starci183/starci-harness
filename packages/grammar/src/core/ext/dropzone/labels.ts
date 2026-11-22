import type { DropzoneRejectReason } from "./files.js"

/** How many items are in each state, for the words a screen reader hears when the list changes. */
export type DropzoneStatusCounts = {
    readonly done: number
    readonly uploading: number
    readonly waiting: number
    readonly error: number
}

/**
 * Every word the upload zone shows or announces. The defaults are English; an app passes its own language (any subset: the rest keep
 * their default). Words that carry a number or a name are functions, so the app owns the grammar of its plurals.
 */
export type DropzoneLabels = {
    /** The zone's title in the idle state, e.g. "Drag and drop files or folders here". */
    readonly title: string
    /** The accepted-types line under the title, from the accepted extensions and the size limit (already formatted, e.g. "10 MB"). */
    readonly acceptedTypes: (types: readonly string[], maxSize: string | undefined) => string
    /** The button that opens the file picker. */
    readonly chooseFiles: string
    /** The button that opens the folder picker (when `folders` is on). */
    readonly chooseFolder: string
    /** The drag-over title, with the target the app named (or none). */
    readonly dropTo: (target: string | undefined) => string
    /** The dragged count under the drag-over title. */
    readonly dragged: (count: number) => string
    /** The title of the rejected state. */
    readonly rejectedTitle: string
    /** One reason a drop was refused, with how many files it refused and the limit it broke. */
    readonly rejected: (reason: DropzoneRejectReason, count: number, limit: { readonly maxSize: string | undefined; readonly maxFiles: number | undefined }) => string
    /** The status words of a list row. */
    readonly done: string
    readonly uploading: (percent: number) => string
    readonly waiting: string
    readonly error: string
    /** The retry action of a failed row. */
    readonly retry: string
    /** Names a row's progress bar, e.g. "Upload of report.pdf". */
    readonly progressOf: (name: string) => string
    /** Names the list of uploads. */
    readonly listLabel: string
    /** What a screen reader hears when the statuses change. */
    readonly summary: (counts: DropzoneStatusCounts) => string
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`

const REJECTED_EN: Readonly<Record<DropzoneRejectReason, (count: number, limit: { readonly maxSize: string | undefined; readonly maxFiles: number | undefined }) => string>> = {
    "too-large": (count, { maxSize }) => `${plural(count, "file is", "files are")} too big${maxSize === undefined ? "" : `: the limit is ${maxSize}`}.`,
    "wrong-type": (count) => `${plural(count, "file is", "files are")} not a type this accepts.`,
    "too-many": (count, { maxFiles }) => `Too many files (${count}): ${maxFiles === undefined || maxFiles <= 1 ? "one at a time" : `up to ${maxFiles} at a time`}.`,
}

/** The English words of the zone. */
export const DEFAULT_DROPZONE_LABELS: DropzoneLabels = Object.freeze({
    title: "Drag and drop files or folders here",
    acceptedTypes: (types, maxSize) => {
        const kinds = types.length === 0 ? "Any file" : types.join(", ")
        return maxSize === undefined ? kinds : `${kinds}, up to ${maxSize} each`
    },
    chooseFiles: "Choose files",
    chooseFolder: "Choose folder",
    dropTo: (target) => (target === undefined ? "Drop to upload" : `Drop to upload to ${target}`),
    dragged: (count) => plural(count, "item", "items"),
    rejectedTitle: "Some files were not added",
    rejected: (reason, count, limit) => REJECTED_EN[reason](count, limit),
    done: "Done",
    uploading: (percent) => `${percent}%`,
    waiting: "Waiting",
    error: "Failed",
    retry: "Retry",
    progressOf: (name) => `Upload of ${name}`,
    listLabel: "Uploads",
    summary: ({ done, uploading, waiting, error }) =>
        [done > 0 ? `${done} done` : "", uploading > 0 ? `${uploading} uploading` : "", waiting > 0 ? `${waiting} waiting` : "", error > 0 ? `${error} failed` : ""].filter((part) => part !== "").join(", "),
})

/** The app's words over the defaults. */
export const resolveDropzoneLabels = (labels: Partial<DropzoneLabels> | undefined): DropzoneLabels => ({ ...DEFAULT_DROPZONE_LABELS, ...labels })
