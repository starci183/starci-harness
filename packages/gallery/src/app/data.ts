import raw from "virtual:starci-gallery/data"
import type { Model } from "../model.ts"

export interface GalleryData {
    readonly app: string
    readonly locale: string
    readonly devUrl: string | null
    readonly model: Model
}

/** What the plugin's data module holds (vite.ts writes it as JSON). */
export const data = raw as GalleryData
