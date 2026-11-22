"use client"

import { useCallback, useState, type MouseEvent } from "react"
import { useDropzone, type FileRejection } from "react-dropzone"
import { acceptedTypesOf, draggedCountOf, filesFromEvent, formatBytes, rejectionsOf, toDropzoneFiles, type DropzoneRejection } from "./files.js"
import { resolveDropzoneLabels } from "./labels.js"
import { DropzoneView, type DropzonePhase } from "./DropzoneView.js"
import type { DropzoneProps } from "./Dropzone.js"

const FOLDER_ATTRIBUTES = ["webkitdirectory", "directory"] as const

/**
 * The live zone: react-dropzone's drop target and hidden input on the Grammar drawing. Loaded lazily by `Dropzone`, so react-dropzone
 * reaches the bundle of a page only when it shows an upload. A dragged folder is walked into its files (`filesFromEvent`); the folder
 * button opens the same input as a folder picker (`webkitdirectory`), so both paths run the same checks.
 */
const DropzoneZone = ({ accept, maxSize, maxFiles, multiple = true, folders = true, onFiles, target, items = [], onRetry, labels: own, isDisabled = false }: Omit<DropzoneProps, "isLoading">) => {
    const labels = resolveDropzoneLabels(own)
    const [rejections, setRejections] = useState<readonly DropzoneRejection[]>([])
    const [draggedCount, setDraggedCount] = useState(0)

    const onDrop = useCallback((accepted: File[], refused: FileRejection[]) => {
        setRejections(rejectionsOf(refused))
        if (accepted.length > 0) onFiles(toDropzoneFiles(accepted))
    }, [onFiles])

    const { getRootProps, getInputProps, inputRef, open, isDragActive } = useDropzone({
        ...(accept === undefined ? {} : { accept: { ...accept } }),
        ...(maxSize === undefined ? {} : { maxSize }),
        ...(maxFiles === undefined ? {} : { maxFiles }),
        multiple,
        disabled: isDisabled,
        noClick: true,
        useFsAccessApi: false,
        getFilesFromEvent: filesFromEvent,
        onDrop,
        onDragEnter: (event) => {
            setRejections([])
            setDraggedCount(draggedCountOf(event))
        },
    })

    const pick = (asFolder: boolean): void => {
        const input = inputRef.current
        for (const name of FOLDER_ATTRIBUTES) {
            if (asFolder) input.setAttribute(name, "")
            else input.removeAttribute(name)
        }
        setRejections([])
        open()
    }

    const phase: DropzonePhase = isDragActive ? "over" : rejections.length > 0 ? "rejected" : "idle"
    const showFolders = folders && multiple
    const onZoneClick = (event: MouseEvent<HTMLElement>): void => {
        if (isDisabled || (event.target instanceof Element && event.target.closest("button, a") !== null)) return
        pick(false)
    }

    return (
        <DropzoneView
            phase={phase}
            labels={labels}
            target={target}
            acceptedTypes={acceptedTypesOf(accept)}
            limits={{ maxSize: maxSize === undefined ? undefined : formatBytes(maxSize), maxFiles: multiple ? maxFiles : 1 }}
            draggedCount={draggedCount}
            rejections={rejections}
            items={items}
            folders={showFolders}
            isDisabled={isDisabled}
            onRetry={onRetry}
            onChooseFiles={() => pick(false)}
            onChooseFolder={() => pick(true)}
            zoneProps={getRootProps({ onClick: onZoneClick })}
            input={<input {...getInputProps()} data-grammar-dropzone-input="true" />}
        />
    )
}

export default DropzoneZone
