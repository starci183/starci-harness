import { copyFileSync, linkSync } from "node:fs"

/** One file to place: its source, its place, and whether it is copied whatever the mode (a file npm rewrites in place). */
export interface PlacedFile {
    readonly from: string
    readonly to: string
    readonly copy: boolean
}

/** The errors of a hard link that fall back to a copy of the file: the volume, the permission or the link count refuses it. */
const FALLBACK = new Set(["EXDEV", "EPERM", "EMLINK", "ENOTSUP", "EACCES"])

/** Hard links the files, or copies them when `linking` is off or a link is refused (a refused volume turns linking off for the rest). Returns how many were copied; any other error throws. */
export const placeChunk = (files: readonly PlacedFile[], linking: boolean): number => {
    let copied = 0
    let link = linking
    for (const file of files) {
        if (file.copy || !link) {
            copyFileSync(file.from, file.to)
            copied += 1
            continue
        }
        try {
            linkSync(file.from, file.to)
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code
            if (code === undefined || !FALLBACK.has(code)) throw error
            if (code === "EXDEV" || code === "ENOTSUP") link = false
            copyFileSync(file.from, file.to)
            copied += 1
        }
    }
    return copied
}
