"use client"

import { withRegionLoading } from "../../regionScope.js"
import { useFieldVariant } from "../../surfaceContext.js"
import { TextArea as HeroTextArea, TextField as HeroTextField } from "@heroui/react"
import { useEffect, useId, useMemo, useState, type ClipboardEvent, type KeyboardEvent } from "react"
import { IconButton } from "../../leaf/IconButton/index.js"
import {
    FieldDescription,
    FieldErrorText,
    FieldLabel,
    FieldSkeletonScope,
    loadingFieldProps,
    fieldVariantAttributes,
    isFieldInvalid,
    vendorFieldProps,
    type FieldControlProps,
} from "../../leaf/Field/index.js"
import type { NoChildren } from "../../tier.js"

/** One person or agent the reader can mention. `label` is what is inserted after the trigger. */
export type TextareaMentionOption = {
    readonly id: string
    readonly label: string
    /** A second muted line in the suggestion list (role, handle). */
    readonly description?: string
}

/**
 * Mention suggestions: typing the trigger (default `@`) at a word start opens a list filtered by what follows it;
 * ArrowUp/ArrowDown move, Enter or Tab inserts `trigger + label + space`, Escape closes. Works on a controlled value
 * (`value` + `onValueChange`), because inserting a mention rewrites the text.
 */
export type TextareaMentions = {
    readonly options: ReadonlyArray<TextareaMentionOption>
    /** Accessible name of the suggestion list, e.g. "People to mention". */
    readonly label: string
    readonly trigger?: string
    /** Called after a mention was inserted. */
    readonly onSelect?: (option: TextareaMentionOption) => void
}

/** The send button of a chat composer. */
export type TextareaSend = {
    /** Accessible name of the icon button, e.g. "Send message". */
    readonly label: string
    readonly onPress: () => void
    readonly isDisabled?: boolean
    readonly isPending?: boolean
}

/** A chat composer (every chat) starts at 2 lines, about 64px. */
export const COMPOSER_MIN_ROWS = 2
/** A chat composer grows with its text up to 6 lines and then scrolls. */
export const COMPOSER_MAX_ROWS = 6

export type TextareaProps = NoChildren & FieldControlProps & {
    readonly id?: string
    readonly placeholder?: string
    readonly value?: string
    readonly defaultValue?: string
    /**
     * Initial visible lines (default 4). A chat composer (a Textarea with `onSubmitShortcut`) ignores it: it always starts at
     * `COMPOSER_MIN_ROWS` lines (2, about 64px) and grows with its text up to `COMPOSER_MAX_ROWS` (6), then scrolls.
     */
    readonly rows?: number
    /**
     * Initial unresolved content (knowledge STATE-8), with skeleton parity: the ready anatomy at the same props (label,
     * description, control box, options) inside an inert, `aria-busy` scope, its control box painted as a Skeleton and its
     * value or mark not drawn, so the loading field keeps the ready box. Nothing is invalid or pending while it loads.
     */
    readonly isLoading?: boolean
    /** Also shows a live `count / max` beside the guidance. */
    readonly maxLength?: number
    readonly minLength?: number
    readonly onValueChange?: (value: string) => void
    /**
     * Chat composer shortcut: Enter (without Shift, outside an IME composition and with no suggestion list open) calls this
     * instead of breaking the line; Shift+Enter still breaks the line.
     */
    readonly onSubmitShortcut?: () => void
    /**
     * Chat composer send button, drawn inside the box at the bottom end of the field so it stays at the bottom as the box
     * grows. Use it with `onSubmitShortcut`; the same `onPress` should run for both.
     */
    readonly send?: TextareaSend
    readonly mentions?: TextareaMentions
    /** Focus left the textarea. */
    readonly onBlur?: () => void
    /** The native paste event of the textarea. */
    readonly onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void
    /** Focuses the textarea when it mounts. */
    readonly autoFocus?: boolean
}

type MentionQuery = { readonly start: number; readonly end: number; readonly text: string }

const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()

/** The trigger word that ends at the caret (`@an` in "hi @an|"), or null. The trigger must start the text or follow a space. */
export const findMentionQuery = (text: string, caret: number, trigger = "@"): MentionQuery | null => {
    const before = text.slice(0, caret)
    const at = before.lastIndexOf(trigger)
    if (at < 0) return null
    if (at > 0 && !/\s/.test(before.charAt(at - 1))) return null
    const query = before.slice(at + trigger.length)
    if (/\s/.test(query)) return null
    return { start: at, end: caret, text: query }
}

/** Options whose label (accent- and case-insensitive) contains the query, at most eight. */
export const filterMentionOptions = (options: ReadonlyArray<TextareaMentionOption>, query: string): ReadonlyArray<TextareaMentionOption> => {
    const q = fold(query)
    return options.filter((o) => fold(o.label).includes(q) || fold(o.description ?? "").includes(q)).slice(0, 8)
}

/*
 * Consumer hook: `starci-core-textarea` names this control's root for a consumer or family
 * stylesheet. No shipped sheet paints it: the root is drawn as a whole by `.starci-core-field`, so
 * a rule on the hook adds to the shared anatomy and never has to replace it.
 */

/**
 * Skeleton parity (knowledge STATE-8): `isLoading` renders the ready anatomy at the same props inside
 * `FieldSkeletonScope` (inert, `aria-busy`, control box painted as a Skeleton), so the loading field keeps the ready box.
 */
const TextareaInner = ({ isLoading = false, ...props }: TextareaProps) => isLoading
    ? <FieldSkeletonScope component="Textarea"><TextareaControl {...loadingFieldProps(props)} /></FieldSkeletonScope>
    : <TextareaControl {...props} />

/** Multi-line text with the shared field anatomy, an optional Enter-to-submit shortcut and optional mention suggestions. */
const TextareaControl = ({
    id,
    placeholder,
    value,
    defaultValue,
    rows = 4,
    send,
    maxLength,
    minLength,
    onValueChange,
    onSubmitShortcut,
    mentions,
    onBlur,
    onPaste,
    autoFocus = false,
    ...field
}: Omit<TextareaProps, "isLoading">) => {
    const variant = useFieldVariant()
    const [uncontrolledLength, setUncontrolledLength] = useState((defaultValue ?? "").length)
    const length = value === undefined ? uncontrolledLength : value.length
    const generatedId = useId()
    const controlId = id ?? `textarea-${generatedId}`
    const listId = `${controlId}-mentions`
    const trigger = mentions?.trigger ?? "@"
    const [query, setQuery] = useState<MentionQuery | null>(null)
    const [active, setActive] = useState(0)
    const suggestions = useMemo(
        () => (mentions === undefined || query === null ? [] : filterMentionOptions(mentions.options, query.text)),
        [mentions, query],
    )
    const isOpen = suggestions.length > 0

    const readQuery = (control: HTMLTextAreaElement) => {
        if (mentions === undefined) return
        const next = control.selectionStart === control.selectionEnd ? findMentionQuery(control.value, control.selectionStart, trigger) : null
        setQuery(next)
        setActive(0)
    }

    const insert = (option: TextareaMentionOption) => {
        const control = document.getElementById(controlId)
        if (!(control instanceof HTMLTextAreaElement) || query === null) return
        const text = control.value
        const inserted = `${trigger}${option.label} `
        const next = `${text.slice(0, query.start)}${inserted}${text.slice(query.end)}`
        const caret = query.start + inserted.length
        onValueChange?.(next)
        setUncontrolledLength(next.length)
        setQuery(null)
        mentions?.onSelect?.(option)
        requestAnimationFrame(() => {
            control.focus()
            control.setSelectionRange(caret, caret)
        })
    }

    const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (isOpen) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault()
                const step = event.key === "ArrowDown" ? 1 : -1
                setActive((current) => (current + step + suggestions.length) % suggestions.length)
                return
            }
            if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault()
                const option = suggestions[active]
                if (option !== undefined) insert(option)
                return
            }
            if (event.key === "Escape") {
                event.preventDefault()
                setQuery(null)
                return
            }
        }
        if (onSubmitShortcut !== undefined && event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            onSubmitShortcut()
        }
    }

    const isComposer = onSubmitShortcut !== undefined
    // A composer grows with its text: the box takes its content height between the 2-line floor and the 6-line ceiling.
    useEffect(() => {
        if (!isComposer) return
        const control = document.getElementById(controlId)
        if (!(control instanceof HTMLTextAreaElement)) return
        const style = getComputedStyle(control)
        const line = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.5
        const chrome = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom) + Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth)
        control.style.blockSize = "auto"
        const fit = Math.min(Math.max(control.scrollHeight + (style.boxSizing === "border-box" ? Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth) : 0), COMPOSER_MIN_ROWS * line + chrome), COMPOSER_MAX_ROWS * line + chrome)
        control.style.blockSize = `${fit}px`
    }, [isComposer, controlId, value, length])

    const activeId = isOpen ? `${listId}-${suggestions[active]?.id ?? ""}` : undefined


    return (
        <HeroTextField
            data-tier="branch"
            data-component="Textarea"
            data-contract="A11Y-1 FEEDBACK-1 STATE-1"
            className="starci-core-field starci-core-textarea"
            fullWidth
            variant={variant}
            {...fieldVariantAttributes(variant)}
            {...vendorFieldProps(field)}
            isReadOnly={field.isReadOnly === true}
            {...(value === undefined ? defaultValue === undefined ? {} : { defaultValue } : { value })}
            {...(maxLength === undefined ? {} : { maxLength })}
            {...(minLength === undefined ? {} : { minLength })}
            onChange={(next) => {
                setUncontrolledLength(next.length)
                onValueChange?.(next)
                // Text can arrive without a key release (IME, paste, a phone keyboard, dictation): re-read the trigger then too.
                if (mentions !== undefined) {
                    queueMicrotask(() => {
                        const control = document.getElementById(controlId)
                        if (control instanceof HTMLTextAreaElement) readQuery(control)
                    })
                }
            }}
        >
            <FieldLabel isHidden={field.isLabelHidden} isRequired={field.isRequired}>{field.label}</FieldLabel>
            <div className="starci-core-textarea-anchor">
                <HeroTextArea
                    id={controlId}
                    rows={isComposer ? COMPOSER_MIN_ROWS : rows}
                    {...(isComposer ? { "data-grammar-composer": "true" } : {})}
                    {...(placeholder === undefined ? {} : { placeholder })}
                    className="starci-core-textarea-control"
                    data-grammar-field-control="true"
                    onKeyDown={onKeyDown}
                    {...(autoFocus ? { autoFocus: true } : {})}
                    {...(onPaste === undefined ? {} : { onPaste })}
                    onBlur={() => {
                        if (mentions !== undefined) setQuery(null)
                        onBlur?.()
                    }}
                    {...(mentions === undefined
                        ? {}
                        : {
                            onKeyUp: (event: KeyboardEvent<HTMLTextAreaElement>) => {
                                if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) readQuery(event.currentTarget)
                            },
                            onClick: (event: { currentTarget: HTMLTextAreaElement }) => readQuery(event.currentTarget),
                            "aria-autocomplete": "list" as const,
                            // A textbox may carry aria-controls / aria-autocomplete / aria-activedescendant, not aria-expanded (ARIA 1.2);
                            // both references are set only while the list exists, so they never point at a missing element.
                            ...(activeId === undefined ? {} : { "aria-controls": listId, "aria-activedescendant": activeId }),
                        })}
                />
                {send === undefined ? null : (
                    <span className="starci-core-textarea-send" data-grammar-composer-send="true">
                        <IconButton
                            glyph="send"
                            intent="commit"
                            size="sm"
                            label={send.label}
                            onPress={send.onPress}
                            {...(send.isDisabled === undefined ? {} : { isDisabled: send.isDisabled })}
                            {...(send.isPending === undefined ? {} : { isPending: send.isPending })}
                        />
                    </span>
                )}
                {mentions === undefined || !isOpen ? null : (
                    <ul id={listId} role="listbox" aria-label={mentions.label} className="starci-core-mention-list" data-grammar-mention-list="true">
                        {suggestions.map((option, index) => (
                            <li
                                key={option.id}
                                id={`${listId}-${option.id}`}
                                role="option"
                                aria-selected={index === active}
                                className="starci-core-mention-option"
                                data-grammar-mention-active={index === active ? "true" : "false"}
                                onMouseDown={(event) => {
                                    event.preventDefault()
                                    insert(option)
                                }}
                                onMouseEnter={() => setActive(index)}
                            >
                                <span className="starci-core-mention-label">{option.label}</span>
                                {option.description === undefined ? null : <span className="starci-core-mention-description">{option.description}</span>}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            {field.description == null && maxLength === undefined ? null : (
                <div className="starci-core-field-meta">
                    <FieldDescription>{field.description}</FieldDescription>
                    {maxLength === undefined ? null : (
                        <span
                            className="starci-core-field-count"
                            data-grammar-field-count="true"
                            data-grammar-invalid={isFieldInvalid(field) || length > maxLength ? "true" : "false"}
                        >
                            {length}/{maxLength}
                        </span>
                    )}
                </div>
            )}
            <FieldErrorText>{field.errorMessage}</FieldErrorText>
        </HeroTextField>
    )
}

/**
 * Skeleton parity (knowledge STATE-8): `isLoading` renders the ready anatomy at the same props inside
 * `FieldSkeletonScope` (inert, `aria-busy`, control box painted as a Skeleton), so the loading field keeps the ready box.
 */
export const Textarea = withRegionLoading(TextareaInner)
