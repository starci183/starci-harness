"use client"

import { useEffect, useRef, useState } from "react"
import { Disclosure } from "../../branch/Disclosure/index.js"
import { DescriptionList } from "../../composite/DescriptionList/index.js"
import { EmptyNotice } from "../../composite/EmptyNotice/index.js"
import { Markdown } from "../../frame/Markdown/index.js"
import { FencedCodeBlock } from "../../frame/MarkdownArticle/index.js"
import { SurfaceCard } from "../../frame/SurfaceCard/index.js"
import { Button } from "../../leaf/Button/index.js"
import { IconButton } from "../../leaf/IconButton/index.js"
import { TablerArrowDown, TablerCheck, TablerCopy, TablerRefresh } from "../../leaf/Icon/tabler.js"
import { InlineStatus } from "../../leaf/InlineStatus/index.js"
import { Text } from "../../leaf/Text/index.js"
import { formatValue, toolStatusOf } from "./model.js"
import type { AiChatLabels, AiChatPart, AiChatResultPreview } from "./types.js"

type ToolCallPart = Extract<AiChatPart, { type: "tool-call" }>

/** The words of an assistant turn: markdown drawn with the core's parts, fences in the code palette with their own Copy. */
export const AiChatText = ({ text, copy }: { readonly text: string; readonly copy: string }) =>
    text.trim() === "" ? null : <Markdown source={text} measure="compact" labels={{ copy, copied: copy }} />

/** The reader's own words: a brand bubble at the end side, the text as typed (line breaks kept, never parsed as markdown). */
export const AiChatUserText = ({ text }: { readonly text: string }) => <span className="starci-ai-chat-user-text">{text}</span>

/** The answer is on its way and has nothing to show yet: the running mark with the app's word for it. */
export const AiChatThinking = ({ label }: { readonly label: string }) => (
    <div className="starci-ai-chat-thinking" data-grammar-ai-chat-thinking="true" role="status">
        <InlineStatus state="running" label={label} />
    </div>
)

/**
 * One tool call: a quiet 1px-edged row with the app's title and its status mark (glyph and words), folded; open, the arguments as facts and
 * the result (a string as text, anything else as JSON in the code palette).
 */
export const AiChatToolCard = ({ part, labels }: { readonly part: ToolCallPart; readonly labels: Pick<AiChatLabels, "toolRunning" | "toolDone" | "toolError" | "copy"> }) => {
    const status = toolStatusOf(part.status, labels)
    const args = Object.entries(part.args).filter(([, value]) => value !== undefined)
    const result = part.result === undefined ? null : formatValue(part.result)
    return (
        <div className="starci-ai-chat-tool" data-grammar-ai-chat-tool={part.status} data-tool-name={part.toolName}>
            <Disclosure
                headingLevel={4}
                title={part.title}
                summary={<InlineStatus state={status.state} label={status.label} />}
                body={(
                    <div className="starci-ai-chat-tool-body">
                        {args.length === 0 ? null : (
                            <DescriptionList
                                layout="stacked"
                                density="compact"
                                items={args.map(([key, value]) => ({ id: key, term: key, description: <span className="starci-ai-chat-multiline">{formatValue(value)}</span> }))}
                            />
                        )}
                        {result === null ? null : typeof part.result === "string"
                            ? <Text as="div"><span className="starci-ai-chat-multiline">{result}</span></Text>
                            : <FencedCodeBlock language="json" label={part.title} code={result} />}
                    </div>
                )}
            />
        </div>
    )
}

/** Copy of an assistant turn: the copy glyph, a check for two seconds once the words reached the clipboard. Named by `label` either way. */
const CopyMessage = ({ text, label }: { readonly text: string; readonly label: string }) => {
    const [copied, setCopied] = useState(false)
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
    useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current) }, [])
    const copy = () => {
        const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
        if (clipboard === undefined) return
        clipboard.writeText(text).then(() => {
            setCopied(true)
            if (timer.current !== null) clearTimeout(timer.current)
            timer.current = setTimeout(() => setCopied(false), 2000)
        }, () => setCopied(false))
    }
    return <IconButton source={copied ? TablerCheck : TablerCopy} size="sm" label={label} onPress={copy} />
}

/** The actions under an assistant turn: copy its words, and on the last one, while nothing runs, retry it. */
export const AiChatMessageActions = ({ text, labels, onRetry }: { readonly text: string; readonly labels: Pick<AiChatLabels, "copy" | "retry">; readonly onRetry: (() => void) | undefined }) => {
    if (text === "" && onRetry === undefined) return null
    return (
        <div className="starci-ai-chat-message-actions" data-grammar-ai-chat-actions="true">
            {text === "" ? null : <CopyMessage text={text} label={labels.copy} />}
            {onRetry === undefined ? null : <IconButton source={TablerRefresh} size="sm" label={labels.retry} onPress={onRetry} />}
        </div>
    )
}

/** Back to the newest message, shown only while the reader is scrolled up. */
export const AiChatJumpToLatest = ({ label, onPress }: { readonly label: string; readonly onPress: () => void }) => (
    <div className="starci-ai-chat-latest" data-grammar-ai-chat-latest="true">
        <IconButton source={TablerArrowDown} size="sm" isFloating label={label} onPress={onPress} />
    </div>
)

/** Nothing said yet: the app's opening words over Grammar's empty glyph. */
export const AiChatEmpty = ({ message }: { readonly message: string }) => (
    <div className="starci-ai-chat-empty" data-grammar-ai-chat-empty="true">
        <EmptyNotice message={message} />
    </div>
)

/**
 * The proposed result: a card with a warning edge while it waits on the reader (success once approved), its rows as stacked facts (a long
 * value keeps its line breaks), and its one band of commands: approve is the region's ONE primary, revise the border look. Approved, the band
 * gives way to the approve words marked done.
 */
export const AiChatPreviewCard = ({ preview, onApprove, onRevise }: { readonly preview: AiChatResultPreview; readonly onApprove: (() => void) | undefined; readonly onRevise: (() => void) | undefined }) => {
    const approved = preview.approved === true
    const approving = preview.approving === true && !approved
    const actions = approved ? (
        <InlineStatus state="done" label={preview.approveLabel} />
    ) : (
        <div className="starci-ai-chat-preview-actions">
            <Button variant="primary" onPress={() => onApprove?.()} isPending={approving} isDisabled={onApprove === undefined}>{preview.approveLabel}</Button>
            <Button variant="border" onPress={() => onRevise?.()} isDisabled={approving || onRevise === undefined}>{preview.reviseLabel}</Button>
        </div>
    )
    return (
        <div className="starci-ai-chat-preview" data-grammar-ai-chat-preview={approved ? "approved" : approving ? "approving" : "waiting"}>
            <SurfaceCard label={preview.title} tone={approved ? "success" : "warning"} actions={actions}>
                <DescriptionList
                    layout="stacked"
                    items={preview.rows.map((row, index) => ({ id: `${index}`, term: row.label, description: <span className="starci-ai-chat-multiline">{row.value}</span> }))}
                />
            </SurfaceCard>
        </div>
    )
}
