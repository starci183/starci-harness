import type { ReactNode } from "react"

export type CodeProps = {
    /** The literal: an identifier, a path, a command, a value. */
    readonly children: ReactNode
}

/** ATOM - `Code`: inline code, a `<code>` in the monospace stack on a soft plate. A block of code is `FencedCodeBlock`. */
export const Code = ({ children }: CodeProps) => (
    <code data-tier="atom" data-component="Code" className="starci-core-code">{children}</code>
)
