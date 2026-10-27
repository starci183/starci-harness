import { MarkdownArticle, Text } from "@starci/grammar/core"
import { Fragment, type ReactNode } from "react"

/** Input of DecisionBody. */
export interface DecisionBodyProps {
    readonly label: string
    readonly paragraphs: readonly string[]
    readonly isSkeleton?: boolean
}

/** `**bold**` and `code` spans of a body paragraph, as the semantic elements MarkdownArticle owns. */
const inline = (paragraph: string): ReactNode[] =>
    paragraph.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={index}>{part.slice(2, -2)}</strong>
        if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={index}>{part.slice(1, -1)}</code>
        return <Fragment key={index}>{part}</Fragment>
    })

/** Composite: a decision's body, paragraph by paragraph; each paragraph rests as a text line while the inbox loads. */
export const DecisionBody = (props: DecisionBodyProps) => (
    <MarkdownArticle ariaLabel={props.label}>
        {props.paragraphs.map((paragraph, index) => (
            <p key={index}>
                <Text as="span" isSkeleton={props.isSkeleton === true}>
                    {inline(paragraph)}
                </Text>
            </p>
        ))}
    </MarkdownArticle>
)
