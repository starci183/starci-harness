"use client"

import { CheckIcon, DocumentDuplicateIcon, ExclamationCircleIcon } from "@heroicons/react/16/solid"
import { InputGroup as HeroInputGroup, Label as HeroLabel, Tooltip as HeroTooltip } from "@heroui/react"
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { useOverlayContainer } from "../../overlayScope.js"
import { useFieldVariant } from "../../surfaceContext.js"
import { FieldSkeletonScope, StaticFieldError, fieldStateAttributes, fieldVariantAttributes, type FieldVariant } from "../../primitive/Field/index.js"
import { tooltipContentClassName } from "../Tooltip/classNames.js"

type CopyFieldBase = {
    /** The visible accessible name of the value. */
    readonly label: ReactNode
    /** Keeps the label for assistive technology only. */
    readonly isLabelHidden?: boolean
    /** Standing guidance under the control; it joins the value's accessible description. */
    readonly description?: ReactNode
    /** The copy action's accessible name, in the app's language. */
    readonly copyLabel: string
    /** Replaces `copyLabel` on the action and is announced politely for about two seconds after a copy. */
    readonly copiedLabel: string
    /** Shown in the field's error slot and announced when the copy failed (the clipboard refused, or `onCopy` rejected). */
    readonly copyErrorLabel: string
    readonly isDisabled?: boolean
    /** Initial unresolved content (knowledge STATE-8): the ready anatomy, inert, its field box painted as a Skeleton. */
    readonly isSkeleton?: boolean
    /** Defaults to `secondary` inside a Grammar surface and `primary` outside (ANATOMY-2 case-1). */
    readonly variant?: FieldVariant
}

/** A value shown in full (truncated in the middle when it does not fit) and copied from what it shows. */
export type CopyFieldPlainProps = CopyFieldBase & {
    readonly masked?: false
    readonly value: string
    /** Called with the value after it reached the clipboard. */
    readonly onCopy?: (value: string) => void
}

/**
 * A secret: the field shows bullets and the last four characters, and only `onCopy` knows the clear value. It resolves the
 * text to copy (a server reveal may take a moment); the field writes it to the clipboard and keeps no copy of it.
 */
export type CopyFieldMaskedProps = CopyFieldBase & {
    readonly masked: true
    /** The trailing characters the app may show; only the last four are drawn. */
    readonly lastFour: string
    readonly onCopy: () => string | Promise<string>
}

export type CopyFieldProps = CopyFieldPlainProps | CopyFieldMaskedProps

/** The copy action's life: at rest, waiting for `onCopy` or the clipboard, confirmed for a moment, or refused. */
export type CopyFieldState = "idle" | "pending" | "copied" | "failed"

const MASK = "•".repeat(8)
/** A value longer than twice this keeps its last characters in view and gives up the middle when it does not fit. */
const TAIL_LENGTH = 8
const COPIED_MS = 2000

/** The value split for middle truncation: the head shrinks under an ellipsis, the tail never does. Text content stays whole. */
const splitForMiddle = (text: string): readonly [string, string] =>
    text.length > TAIL_LENGTH * 2 ? [text.slice(0, -TAIL_LENGTH), text.slice(-TAIL_LENGTH)] : [text, ""]

/**
 * Writes the text a copy resolves. A pending reveal goes through a `ClipboardItem` built in the press, so a browser that ties
 * clipboard access to the press (Safari) still accepts it; where that is refused the resolved text is written directly.
 */
const writeClipboard = async (text: string | Promise<string>): Promise<void> => {
    const { clipboard } = navigator
    if (typeof text !== "string" && typeof ClipboardItem !== "undefined") {
        try {
            await clipboard.write([new ClipboardItem({ "text/plain": text.then((resolved) => new Blob([resolved], { type: "text/plain" })) })])
            return
        } catch {
            // Fall through: the reveal may still resolve, and writeText is the API every browser takes.
        }
    }
    await clipboard.writeText(await text)
}

/**
 * Skeleton parity (knowledge STATE-8): `isSkeleton` renders the ready anatomy at the same props inside `FieldSkeletonScope`
 * (inert, `aria-busy`, the field box painted as a Skeleton), so the loading field keeps the ready box, label and description.
 */
export const CopyField = (props: CopyFieldProps) => props.isSkeleton === true
    ? <FieldSkeletonScope component="CopyField"><CopyFieldControl {...props} /></FieldSkeletonScope>
    : <CopyFieldControl {...props} />

/**
 * A read-only value with its copy action inside the field, at its end: HeroUI's field anatomy (label, the InputGroup frame
 * with the value and a Suffix action, description, error) at the height of every single-line field, so it sits level with
 * Input, Select and NumberField in a row. The value is a read-only textbox named by the label; its text content is the whole
 * value (screen readers read all of it), drawn truncated in the middle when it does not fit, with the full value in a
 * Tooltip on hover and focus. A masked field draws only bullets and the last four characters and has no Tooltip.
 */
const CopyFieldControl = (props: CopyFieldProps) => {
    const { label, isLabelHidden = false, description, copyLabel, copiedLabel, copyErrorLabel, isDisabled = false, isSkeleton = false } = props
    const variant = useFieldVariant(props.variant)
    const id = `copy-field${useId().replaceAll(":", "")}`
    const labelId = `${id}-label`
    const descriptionId = description == null ? undefined : `${id}-description`
    const errorId = `${id}-error`
    const [state, setState] = useState<CopyFieldState>("idle")
    const failed = state === "failed" && !isSkeleton
    const shown = props.masked === true ? `${MASK}${props.lastFour.slice(-4)}` : props.value
    const [head, tail] = props.masked === true ? [MASK, props.lastFour.slice(-4)] as const : splitForMiddle(props.value)
    const headRef = useRef<HTMLSpanElement>(null)
    const [isTruncated, setIsTruncated] = useState(false)
    const { anchor, container } = useOverlayContainer("Tooltip")

    useLayoutEffect(() => {
        const node = headRef.current
        if (node === null) return
        const measure = () => setIsTruncated(node.scrollWidth > node.clientWidth)
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(node)
        return () => observer.disconnect()
    }, [shown])

    useEffect(() => {
        if (state !== "copied") return
        const timer = setTimeout(() => setState("idle"), COPIED_MS)
        return () => clearTimeout(timer)
    }, [state])

    const copy = async () => {
        if (state === "pending") return
        setState("pending")
        try {
            if (props.masked === true) {
                await writeClipboard(props.onCopy())
            } else {
                await writeClipboard(props.value)
                props.onCopy?.(props.value)
            }
            setState("copied")
        } catch {
            setState("failed")
        }
    }

    const describedBy = [descriptionId, failed ? errorId : undefined].filter((part) => part !== undefined).join(" ")
    const actionName = state === "copied" ? copiedLabel : copyLabel
    const Glyph = state === "copied" ? CheckIcon : failed ? ExclamationCircleIcon : DocumentDuplicateIcon
    const announcement = state === "copied" ? copiedLabel : failed ? copyErrorLabel : ""
    const showsTooltip = props.masked !== true && isTruncated && !isSkeleton

    return (
        <div
            data-tier="branch"
            data-component="CopyField"
            data-contract="A11Y-1 FEEDBACK-1 STATE-8"
            className="starci-core-field starci-core-copy-field"
            data-grammar-copy-masked={props.masked === true ? "true" : "false"}
            data-grammar-copy-state={isSkeleton ? "idle" : state}
            {...fieldVariantAttributes(variant)}
            {...fieldStateAttributes({ isInvalid: failed, isDisabled, isReadOnly: true, isPending: state === "pending" })}
        >
            <HeroLabel
                id={labelId}
                className={isLabelHidden ? "starci-core-field-label starci-core-form-label--screen-reader" : "starci-core-field-label"}
                data-grammar-field-label="true"
            >
                {label}
            </HeroLabel>
            <HeroInputGroup
                fullWidth
                variant={variant}
                className="starci-core-copy-field-group"
                data-grammar-field-control="true"
                {...(isDisabled ? { isDisabled: true } : {})}
                {...(failed ? { isInvalid: true } : {})}
            >
                <HeroTooltip delay={0} isDisabled={!showsTooltip}>
                    <HeroTooltip.Trigger
                        role="textbox"
                        aria-readonly="true"
                        aria-labelledby={labelId}
                        {...(describedBy === "" ? {} : { "aria-describedby": describedBy })}
                        {...(isDisabled ? { "aria-disabled": "true", tabIndex: -1 } : {})}
                        className="starci-core-copy-field-value"
                        data-grammar-copy-value="true"
                        data-grammar-truncated={isTruncated ? "true" : "false"}
                    >
                        <span ref={headRef} className="starci-core-copy-field-head" data-grammar-copy-head="true">{head}</span>
                        {tail === "" ? null : <span className="starci-core-copy-field-tail" data-grammar-copy-tail="true">{tail}</span>}
                    </HeroTooltip.Trigger>
                    {container === null || !showsTooltip ? null : (
                        <HeroTooltip.Content
                            UNSTABLE_portalContainer={container}
                            placement="top"
                            className={`${tooltipContentClassName} starci-core-copy-field-tooltip`}
                            data-grammar-tooltip="true"
                            data-grammar-tooltip-content="true"
                            data-grammar-copy-full-value="true"
                        >
                            {shown}
                        </HeroTooltip.Content>
                    )}
                </HeroTooltip>
                <HeroInputGroup.Suffix className="starci-core-input-actions">
                    <button
                        type="button"
                        aria-label={actionName}
                        disabled={isDisabled}
                        {...(failed ? { "aria-describedby": errorId } : {})}
                        {...(state === "pending" ? { "aria-busy": true } : {})}
                        data-contract="TONE-2"
                        data-copied={state === "copied" ? "true" : "false"}
                        data-grammar-copy-action="true"
                        className="starci-core-input-reveal starci-core-input-copy"
                        onClick={() => void copy()}
                    >
                        <Glyph aria-hidden="true" className="starci-core-input-reveal-icon" />
                    </button>
                </HeroInputGroup.Suffix>
            </HeroInputGroup>
            {descriptionId === undefined ? null : (
                <span id={descriptionId} className="starci-core-field-description" data-grammar-field-description="true">{description}</span>
            )}
            {failed ? <StaticFieldError id={errorId}>{copyErrorLabel}</StaticFieldError> : null}
            <span className="starci-core-input-live" role="status" aria-live="polite">{announcement}</span>
            {anchor}
        </div>
    )
}
