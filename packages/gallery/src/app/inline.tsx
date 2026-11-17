import { Code } from "@starci/grammar/core"
import type { ReactNode } from "react"

/** The inline markdown of an explain.md line (`code` and **bold**) as nodes, never as HTML. */
export function Inline({ text }: { readonly text: string }): ReactNode {
    const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/u).filter((part) => part !== "")
    return parts.map((part, index) => {
        if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <Code key={index}>{part.slice(1, -1)}</Code>
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={index}>{part.slice(2, -2)}</strong>
        return part
    })
}
