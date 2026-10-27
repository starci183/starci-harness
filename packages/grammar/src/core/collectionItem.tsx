"use client"

import { createContext, useContext, type ReactNode } from "react"
import { STARCI_CORE_DNA } from "./dna.js"
import { OFFSET_POP_DNA } from "../offset-pop/dna.js"

/** Item previews support one, two or three visible lines, or `wrap` to show every line; their full text remains accessible. */
export type ItemDescriptionLines = 1 | 2 | 3 | "wrap"

type CollectionItemPresentation = {
    readonly descriptionLines: Exclude<ItemDescriptionLines, "wrap">
    readonly unreadWeight: number
}

const CollectionItemContext = createContext<CollectionItemPresentation>(STARCI_CORE_DNA.collectionItem)

/** Each Grammar root selects its family's item typography, including inside nested family scopes. */
export const CollectionItemFamilyProvider = ({ family, children }: { readonly family?: string | undefined; readonly children: ReactNode }) => (
    <CollectionItemContext.Provider value={family === "offset-pop" ? OFFSET_POP_DNA.collectionItem : STARCI_CORE_DNA.collectionItem}>
        {children}
    </CollectionItemContext.Provider>
)

/** Shared collection renderers read their preview limits and unread weight from the active DNA. */
export const useCollectionItemPresentation = (): CollectionItemPresentation => useContext(CollectionItemContext)
