import type { IconSource } from "./leaf/Icon/index.js"
import { TablerFileText, TablerMovie, TablerMusic, TablerPaperclip, TablerPhoto } from "./leaf/Icon/tabler.js"

/** What a file is, as the Grammar draws it: a picture, a video, a sound, a document (pdf, text, sheet), or a file of another kind. */
export type FileKind = "image" | "video" | "audio" | "document" | "file"

/** The one glyph of each file kind, shared by the media grid and the file mark of an ERD field, so a kind reads the same everywhere. */
export const FILE_GLYPHS: Readonly<Record<FileKind, IconSource>> = {
    image: TablerPhoto,
    video: TablerMovie,
    audio: TablerMusic,
    document: TablerFileText,
    file: TablerPaperclip,
}
