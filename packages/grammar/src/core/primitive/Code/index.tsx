import type { ReactNode } from "react"
import { SkeletonPlaceholder } from "../Skeleton/index.js"

export type CodeProps = {
    /** The literal: an identifier, a path, a command, a value. */
    readonly children: ReactNode
    /** Unresolved literal (knowledge STATE-8): the same plate, its text laid out unseen under a shimmer (skeleton parity). */
    readonly isSkeleton?: boolean
}

/** ATOM - `Code`: inline code, a `<code>` in the monospace stack on a soft plate. A block of code is `FencedCodeBlock`. */
export const Code = ({ children, isSkeleton = false }: CodeProps) => isSkeleton ? (
    <code data-tier="atom" data-component="Code" data-loading="true" aria-hidden="true" className="starci-core-code"><SkeletonPlaceholder>{children}</SkeletonPlaceholder></code>
) : (
    <code data-tier="atom" data-component="Code" className="starci-core-code">{children}</code>
)
