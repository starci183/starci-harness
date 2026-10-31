"use client"

import type { ReactNode } from "react"
import { useFillMeasure } from "../../composite/FillViewport/useFillMeasure.js"
import type { FillViewportMinHeight } from "../../composite/FillViewport/index.js"

/**
 * The measured fill box of `Page chrome="panes"`: it holds the page's one PaneGrid flush under the band and reaches the
 * viewport bottom. It is the client part of Page, so a Page rendered by a server component never calls the measuring hook.
 */
export const PanesFill = ({ minHeight, children }: { readonly minHeight: FillViewportMinHeight; readonly children: ReactNode }) => {
    const fillRef = useFillMeasure()
    return (
        <div
            ref={fillRef}
            className="starci-core-page-body starci-core-page-panes-fill"
            data-grammar-page-body="true"
            data-grammar-fill-min={minHeight}
        >
            {children}
        </div>
    )
}
