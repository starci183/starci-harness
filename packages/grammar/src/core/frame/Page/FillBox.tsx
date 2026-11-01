"use client"

import type { ReactNode } from "react"
import type { PageMinHeight } from "./index.js"
import { useFillMeasure } from "./useFillMeasure.js"

/**
 * The measured fill box of `Page chrome="bleed"` and `chrome="panes"`: it holds the page's body at the viewport height left
 * below the band, less any Grammar bottom chrome. It is the client part of Page, so a Page rendered by a server component
 * never calls the measuring hook.
 */
export const FillBox = ({ minHeight, children, ...panel }: { readonly minHeight: PageMinHeight; readonly children: ReactNode; readonly id?: string; readonly role?: string; readonly "aria-label"?: string }) => {
    const fillRef = useFillMeasure()
    return (
        <div
            ref={fillRef}
            className="starci-core-page-body starci-core-page-fill"
            data-grammar-page-body="true"
            data-grammar-fill-min={minHeight}
            {...panel}
        >
            {children}
        </div>
    )
}
