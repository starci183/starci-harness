/**
 * The pure half of the upload extension: what a dropped or picked file is called, how a dragged folder becomes a flat list of files
 * with their relative paths, which kind of file a name is (its 24px icon), and why a file was refused, in words. Nothing here
 * imports react-dropzone, so the specs read it without a browser.
 */

/** A file the zone accepted, with its path relative to what was dropped or picked: `photos/2026/a.jpg`, or the bare name. */
export type DropzoneFile = {
    readonly file: File
    readonly path: string
}

/** The accepted types: a MIME type (or `image/*`) mapped to its extensions, e.g. `{ "image/png": [".png"], "application/pdf": [".pdf"] }`. */
export type DropzoneAccept = Readonly<Record<string, readonly string[]>>

/** Why a file was refused: too big, a type the zone does not accept, or more files than it takes at once. */
export type DropzoneRejectReason = "too-large" | "wrong-type" | "too-many"

/** One reason with how many files it refused. */
export type DropzoneRejection = {
    readonly reason: DropzoneRejectReason
    readonly count: number
}

/** The kind of a file, which picks its icon in a list row. */
export type DropzoneFileKind = "image" | "video" | "audio" | "pdf" | "sheet" | "archive" | "text" | "file"

const PATHS = new WeakMap<File, string>()

/** Strips the leading `./` or `/` a browser or a file selector puts before a relative path. */
const cleanPath = (path: string): string => path.replace(/^(?:\.\/|\/)+/u, "")

/** Remembers the relative path a folder walk found for a file. */
export const rememberPath = (file: File, path: string): File => {
    PATHS.set(file, cleanPath(path))
    return file
}

/**
 * The relative path of a file: the one a folder walk remembered, else the `webkitRelativePath` a folder picker gives, else the
 * `path` or `relativePath` a file selector set, else its name.
 */
export const relativePathOf = (file: File): string => {
    const remembered = PATHS.get(file)
    if (remembered !== undefined && remembered !== "") return remembered
    for (const key of ["webkitRelativePath", "relativePath", "path"]) {
        const value: unknown = Reflect.get(file, key)
        if (typeof value === "string" && cleanPath(value) !== "") return cleanPath(value)
    }
    return file.name
}

/** The accepted files with their relative paths, in the order they came. */
export const toDropzoneFiles = (files: readonly File[]): DropzoneFile[] => files.map((file) => ({ file, path: relativePathOf(file) }))

/** The part of a `FileSystemEntry` a folder walk reads (the browser's drag-and-drop entries API). */
export type DropEntry = {
    readonly isFile: boolean
    readonly isDirectory: boolean
    readonly name: string
    readonly fullPath: string
    readonly file?: (success: (file: File) => void, failure?: (error: unknown) => void) => void
    readonly createReader?: () => { readonly readEntries: (success: (entries: readonly DropEntry[]) => void, failure?: (error: unknown) => void) => void }
}

const fileOf = (entry: DropEntry): Promise<File | null> =>
    new Promise((resolve) => {
        if (entry.file === undefined) {
            resolve(null)
            return
        }
        entry.file((file) => resolve(rememberPath(file, entry.fullPath === "" ? entry.name : entry.fullPath)), () => resolve(null))
    })

/** Every entry of a folder: `readEntries` hands them out in batches (100 in Chromium) until it hands out none. */
const childrenOf = async (entry: DropEntry): Promise<DropEntry[]> => {
    const reader = entry.createReader?.()
    if (reader === undefined) return []
    const all: DropEntry[] = []
    for (;;) {
        const batch = await new Promise<readonly DropEntry[]>((resolve) => reader.readEntries(resolve, () => resolve([])))
        if (batch.length === 0) return all
        all.push(...batch)
    }
}

/**
 * Flattens dropped entries into their files, depth first, each remembering its path from the dropped root (`album/2026/a.jpg`).
 * A folder contributes its files and no entry of its own; an entry that cannot be read is skipped.
 */
export const flattenEntries = async (entries: readonly DropEntry[]): Promise<File[]> => {
    const files: File[] = []
    for (const entry of entries) {
        if (entry.isDirectory) files.push(...(await flattenEntries(await childrenOf(entry))))
        else if (entry.isFile) {
            const file = await fileOf(entry)
            if (file !== null) files.push(file)
        }
    }
    return files
}

type ItemLike = { readonly kind: string; readonly type?: string; readonly webkitGetAsEntry?: () => unknown; readonly getAsFile?: () => File | null }

const isDropEntry = (value: unknown): value is DropEntry =>
    typeof value === "object" && value !== null && typeof Reflect.get(value, "isDirectory") === "boolean" && typeof Reflect.get(value, "isFile") === "boolean"

const itemsOf = (event: unknown): readonly ItemLike[] => {
    const transfer: unknown = typeof event === "object" && event !== null ? Reflect.get(event, "dataTransfer") : undefined
    const items: unknown = typeof transfer === "object" && transfer !== null ? Reflect.get(transfer, "items") : undefined
    return items !== null && typeof items === "object" && "length" in items ? (Array.from(items as ArrayLike<ItemLike>)) : []
}

const inputFilesOf = (event: unknown): File[] => {
    const target: unknown = typeof event === "object" && event !== null ? Reflect.get(event, "target") : undefined
    const files: unknown = typeof target === "object" && target !== null ? Reflect.get(target, "files") : undefined
    return files !== null && typeof files === "object" && "length" in files ? Array.from(files as ArrayLike<File>) : []
}

/**
 * The files of a drop or a pick, for the zone's `getFilesFromEvent`. A drop walks every dragged folder into its files; a drag that has
 * not dropped yet only counts its items (their names cannot be read before the drop); a picker's files keep the `webkitRelativePath`
 * of a picked folder.
 */
export const filesFromEvent = async (event: unknown): Promise<Array<File | DataTransferItem>> => {
    const type: unknown = typeof event === "object" && event !== null ? Reflect.get(event, "type") : undefined
    const items = itemsOf(event).filter((item) => item.kind === "file")
    if (items.length > 0 && type !== "drop") return items as unknown as DataTransferItem[]
    if (items.length > 0) {
        const entries: DropEntry[] = []
        const loose: File[] = []
        for (const item of items) {
            const entry = item.webkitGetAsEntry?.()
            if (isDropEntry(entry)) entries.push(entry)
            else {
                const file = item.getAsFile?.()
                if (file != null) loose.push(file)
            }
        }
        return [...(await flattenEntries(entries)), ...loose]
    }
    return inputFilesOf(event)
}

/** How many things are being dragged over the zone (a folder counts once): the dragged count of the drag-over state. */
export const draggedCountOf = (event: unknown): number => itemsOf(event).filter((item) => item.kind === "file").length

const EXTENSION_KIND: Readonly<Record<string, DropzoneFileKind>> = {
    png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", svg: "image", heic: "image", avif: "image",
    mp4: "video", mov: "video", webm: "video", mkv: "video",
    mp3: "audio", wav: "audio", m4a: "audio", ogg: "audio",
    pdf: "pdf",
    xls: "sheet", xlsx: "sheet", csv: "sheet", ods: "sheet",
    zip: "archive", rar: "archive", "7z": "archive", gz: "archive", tar: "archive",
    txt: "text", md: "text", doc: "text", docx: "text", rtf: "text", odt: "text",
}

/** The kind of a file from its MIME type, else from its extension; `file` when neither says. */
export const fileKindOf = (name: string, type = ""): DropzoneFileKind => {
    if (type.startsWith("image/")) return "image"
    if (type.startsWith("video/")) return "video"
    if (type.startsWith("audio/")) return "audio"
    if (type === "application/pdf") return "pdf"
    const extension = /\.([^./\\]+)$/u.exec(name)?.[1]?.toLowerCase()
    return (extension === undefined ? undefined : EXTENSION_KIND[extension]) ?? "file"
}

const REASON_OF_CODE: Readonly<Record<string, DropzoneRejectReason>> = {
    "file-too-large": "too-large",
    "file-invalid-type": "wrong-type",
    "too-many-files": "too-many",
}

/** The refusals of one drop, as react-dropzone reports them: each file with its error codes. */
export type RefusedFile = { readonly errors: readonly { readonly code: string }[] }

/**
 * Groups refused files by reason, in a fixed order (too many, too big, wrong type). Too many refuses the whole drop, so it is said once
 * and alone; otherwise each file counts once under its first reason.
 */
export const rejectionsOf = (refused: readonly RefusedFile[]): DropzoneRejection[] => {
    if (refused.some((file) => file.errors.some((error) => error.code === "too-many-files"))) return [{ reason: "too-many", count: refused.length }]
    const counts = new Map<DropzoneRejectReason, number>()
    for (const file of refused) {
        const reason = file.errors.map((error) => REASON_OF_CODE[error.code]).find((value) => value !== undefined) ?? "wrong-type"
        counts.set(reason, (counts.get(reason) ?? 0) + 1)
    }
    return (["too-large", "wrong-type"] as const).flatMap((reason) => {
        const count = counts.get(reason)
        return count === undefined ? [] : [{ reason, count }]
    })
}

/** A byte count as people read it: `900 B`, `12 KB`, `10 MB`, `1.5 GB` (1024 steps, one decimal under 10). */
export const formatBytes = (bytes: number): string => {
    const units = ["B", "KB", "MB", "GB", "TB"]
    let value = Math.max(0, bytes)
    let unit = 0
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024
        unit += 1
    }
    const shown = unit === 0 || value >= 10 || Number.isInteger(value) ? String(Math.round(value)) : value.toFixed(1)
    return `${shown} ${units[unit] ?? "B"}`
}

/** The accepted types as people read them: the extensions in capitals (`PNG, JPG, PDF`), else the MIME families (`image`). */
export const acceptedTypesOf = (accept: DropzoneAccept | undefined): readonly string[] => {
    if (accept === undefined) return []
    const extensions = Object.values(accept).flat().map((extension) => extension.replace(/^\./u, "").toUpperCase())
    const families = Object.entries(accept).filter(([, list]) => list.length === 0).map(([type]) => type.replace(/\/\*$/u, ""))
    return [...new Set([...extensions, ...families])]
}
