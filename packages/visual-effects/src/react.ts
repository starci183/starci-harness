"use client"

import { useEffect } from "react"
import { fireConfetti } from "./confetti/fire.ts"
import type { ConfettiPreset } from "./confetti/presets.ts"
import type { EffectHandle } from "./core/overlay.ts"

/** The effects a page can play when a part of it mounts, each with its named presets. */
export interface EffectPresets {
    readonly confetti: ConfettiPreset
}

/** What the mount-time effect plays. */
export interface EffectOnMountProps<Effect extends keyof EffectPresets = keyof EffectPresets> {
    /** The effect. */
    readonly effect: Effect
    /** One of the effect's presets (each effect has a default). */
    readonly preset?: EffectPresets[Effect]
    /** Waits this many milliseconds after mount, so the page settles first (default 250). */
    readonly delayMs?: number
}

/** Starts one effect by name and preset. */
const PLAYERS: Readonly<{ [Effect in keyof EffectPresets]: (preset: EffectPresets[Effect] | undefined) => EffectHandle }> = {
    confetti: (preset) => fireConfetti(preset === undefined ? {} : { preset }),
}

/**
 * Plays one effect once when it mounts and stops it when it unmounts. It draws nothing in the tree, so a server page can place
 * it beside the content of a success screen; the colours are the page's Grammar theme.
 */
export const EffectOnMount = <Effect extends keyof EffectPresets>(props: EffectOnMountProps<Effect>): null => {
    const { effect, preset } = props
    const delayMs = props.delayMs ?? 250
    useEffect(() => {
        let stop: () => void = () => undefined
        const timer = setTimeout(() => {
            stop = PLAYERS[effect](preset).stop
        }, delayMs)
        return () => {
            clearTimeout(timer)
            stop()
        }
    }, [effect, preset, delayMs])
    return null
}
