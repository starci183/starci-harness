"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "../../leaf/Button/index.js"

type CopyActionProps = {
    /** The text written to the clipboard. */
    readonly code: string
    readonly copyLabel: string
    readonly copiedLabel: string
    readonly copyErrorLabel: string
}

type CopyState = "idle" | "copied" | "failed"

/** The Copy command in the header of a fenced code block: a neutral `sm` Button; the result is announced politely. */
export const CopyAction = (props: CopyActionProps) => {
    const [state, setState] = useState<CopyState>("idle")
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
    useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current) }, [])
    const settle = (next: CopyState) => {
        setState(next)
        if (timer.current !== null) clearTimeout(timer.current)
        timer.current = setTimeout(() => setState("idle"), 2000)
    }
    const copy = () => {
        const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
        if (clipboard === undefined) return settle("failed")
        clipboard.writeText(props.code).then(() => settle("copied"), () => settle("failed"))
    }
    return (
        <>
            <Button intent="neutral" size="sm" onPress={copy}>{state === "copied" ? props.copiedLabel : props.copyLabel}</Button>
            <span role="status" className="starci-core-nav-visually-hidden">{state === "copied" ? props.copiedLabel : state === "failed" ? props.copyErrorLabel : ""}</span>
        </>
    )
}
