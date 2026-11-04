"use client"

import { useRef } from "react"
import { useIsLoading } from "../../regionScope.js"
import { IconButton } from "../../leaf/IconButton/index.js"
import type { IconSource } from "../../leaf/Icon/index.js"
import type { NoChildren } from "../../tier.js"

export type FileButtonProps = NoChildren & {
    /** Required accessible name for the glyph-only control ("Attach a file"). */
    readonly label: string
    /** The glyph; its identity is the app's, as for `IconButton`. */
    readonly source: IconSource
    /** Native `accept` list, e.g. `image/*,.pdf`. A hint to the picker, not a security check. */
    readonly accept?: string
    readonly multiple?: boolean
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
export const FileButton = ({ label, source, accept, multiple = false, isDisabled = false, isLoading: own, onFilesChange }: FileButtonProps) => {
    const input = useRef<HTMLInputElement>(null)
    const isLoading = useIsLoading(own)
    if (isLoading) {
        return (
            <span className="starci-core-file-button" data-tier="composite" data-component="FileButton" data-loading="true">
                <IconButton source={source} label={label} intent="neutral" isLoading />
            </span>
        )
    }
    return (
        <span className="starci-core-file-button" data-tier="composite" data-component="FileButton">
            <IconButton source={source} label={label} intent="neutral" isDisabled={isDisabled} onPress={() => input.current?.click()} />
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
        </span>
    )
}
