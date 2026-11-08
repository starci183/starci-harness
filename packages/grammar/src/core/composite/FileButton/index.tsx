"use client"

import { useId, useRef } from "react"
import { useIsLoading } from "../../regionScope.js"
import { Button } from "../../leaf/Button/index.js"
import { IconButton } from "../../leaf/IconButton/index.js"
import { type IconSource } from "../../leaf/Icon/index.js"
import { Text } from "../../leaf/Text/index.js"
import type { NoChildren } from "../../tier.js"

export type FileButtonProps = NoChildren & {
    /** Required accessible name for the glyph-only control ("Attach a file"). */
    readonly label: string
    /** The glyph; its identity is the app's, as for `IconButton`. */
    readonly source: IconSource
    /** Native `accept` list, e.g. `image/*,.pdf`. A hint to the picker, not a security check. */
    readonly accept?: string
    readonly multiple?: boolean
    /**
     * A visible word for the picker ("Change picture"): the control is then a pill `Button` with the glyph before its text (still named by
     * `label`); without it the control is the glyph-only `IconButton`.
     */
    readonly text?: string
    /** Guidance under the control ("PNG, JPEG or WebP, up to 2 MB"), its `aria-describedby`. */
    readonly description?: string
    /** The refusal of the last pick ("Only PNG, JPEG or WebP"), danger tone under the control, announced; it replaces `description`. */
    readonly errorMessage?: string
    readonly isDisabled?: boolean
    /** Unresolved: the control draws as the geometry of the ready button (a Skeleton), nothing opens and no input exists. A loading region tells it too. */
    readonly isLoading?: boolean
    /** The files the reader picked. Upload, size checks and previews are the app's. */
    readonly onFilesChange: (files: Array<File>) => void
}

/**
 * The control that opens the browser's file picker, as large as an `IconButton` (it is one, over a native file input). For a place
 * that takes a file as one action among others (a composer, a toolbar, a row); a drop area the reader aims a file at is
 * `FileDropzone`. The input is the browser's, so picking, the dialog and the files are native; it is cleared after each pick, so
 * choosing the same file twice still reports it.
 */
export const FileButton = ({ label, source, accept, multiple = false, text, description, errorMessage, isDisabled = false, isLoading: own, onFilesChange }: FileButtonProps) => {
    const input = useRef<HTMLInputElement>(null)
    const noteId = useId()
    const isLoading = useIsLoading(own)
    const note = errorMessage ?? description
    const control = isLoading
        ? text === undefined
            ? <IconButton source={source} label={label} intent="neutral" isLoading />
            : <Button intent="alternative" size="sm" isLoading>{text}</Button>
        : text === undefined
            ? <IconButton source={source} label={label} intent="neutral" isDisabled={isDisabled} onPress={() => input.current?.click()} />
            : <Button intent="alternative" size="sm" isDisabled={isDisabled} aria-label={label} onPress={() => input.current?.click()} {...(note === undefined ? {} : { "aria-describedby": noteId })}>{text}</Button>
    return (
        <span className="starci-core-file-button" data-tier="composite" data-component="FileButton" {...(isLoading ? { "data-loading": "true" } : {})} {...(note === undefined ? {} : { "data-grammar-file-button-note": errorMessage === undefined ? "description" : "error" })}>
            {control}
            {isLoading ? null : (
                <input
                    ref={input}
                    hidden
                    type="file"
                    tabIndex={-1}
                    {...(accept === undefined ? {} : { accept })}
                    multiple={multiple}
                    disabled={isDisabled}
                    onChange={(event) => {
                        const files = Array.from(event.currentTarget.files ?? [])
                        event.currentTarget.value = ""
                        if (files.length > 0) onFilesChange(files)
                    }}
                />
            )}
            {note === undefined ? null : (
                <span id={noteId} className="starci-core-file-button-note" data-tone={errorMessage === undefined ? "muted" : "danger"} {...(errorMessage === undefined ? {} : { role: "alert" })}>
                    {isLoading ? <Text size="xs" tone="muted" isLoading>{note}</Text> : note}
                </span>
            )}
        </span>
    )
}
