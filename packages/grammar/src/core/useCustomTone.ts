"use client"

import { useEffect, useRef, type RefObject } from "react"
import { assertToneDeclared, customToneProps, isCustomTone } from "../common/tones.js"

/**
 * The one hook of app-added tones. For a tone that is not among the component's built-in ones it returns the attributes to spread on the
 * root (the stamp and the four variables) and a ref; in development a declared tone with a missing token throws on mount.
 * For a built-in tone it returns no attributes and does nothing.
 */
export const useCustomTone = (tone: string, builtIn: readonly string[]): { readonly ref: RefObject<HTMLElement | null>; readonly attrs: ReturnType<typeof customToneProps> | Record<string, never> } => {
    const ref = useRef<HTMLElement | null>(null)
    const custom = isCustomTone(tone, builtIn)
    useEffect(() => {
        if (custom) assertToneDeclared(ref.current, tone)
    }, [custom, tone])
    return { ref, attrs: custom ? customToneProps(tone) : {} }
}
