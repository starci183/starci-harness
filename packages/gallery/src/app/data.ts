import raw from "virtual:starci-gallery/data"
import type { Board } from "../board.ts"
import type { Model } from "../model.ts"

export interface GalleryData {
    readonly app: string
    readonly locale: string
    readonly devUrl: string | null
    readonly model: Model
    /** The design board (PROJECT-GALLERY-9), null when the gallery keeps no board.yaml. */
    readonly board: Board | null
}

/** What the plugin's data module holds (vite.ts writes it as JSON). */
export const data = raw as GalleryData
