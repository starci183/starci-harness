import type { IconSourceProps } from "../Icon/index.js"

/** The close glyph an `IconButton` with `intent="dismiss"` draws when it is given no `source`. */
export const DismissGlyph = (props: IconSourceProps) => (
    <svg {...props} fill="none" focusable="false" viewBox="0 0 24 24">
        <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
)
