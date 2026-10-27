"use client"

import { createContext, useContext, type ReactNode } from "react"
import { STARCI_CORE_DNA } from "./dna.js"
import { OFFSET_POP_DNA } from "../offset-pop/dna.js"
import type { ButtonVariant } from "./primitive/Button/index.js"

export type ButtonIntent = "commit" | "alternative" | "dismiss" | "neutral" | "destructive"
export type DestructiveStep = "entry" | "confirm"
export type ButtonPlacement = "decision" | "item" | "chrome"

/** A step describes a destructive consequence and cannot be attached to another intent. */
export type ButtonIntentProps =
    | { readonly intent?: Exclude<ButtonIntent, "destructive">; readonly step?: never }
    | { readonly intent: "destructive"; readonly step?: DestructiveStep }

type IntentMapping = {
    readonly commit: Readonly<Record<ButtonPlacement, ButtonVariant>>
    readonly alternative: ButtonVariant
    readonly dismiss: ButtonVariant
    readonly neutral: {
        readonly button: Readonly<Record<ButtonPlacement, ButtonVariant>>
        readonly iconButton: Readonly<Record<ButtonPlacement | "navbar", ButtonVariant>>
    }
    readonly destructive: Readonly<Record<DestructiveStep, ButtonVariant>>
}

const FamilyContext = createContext<IntentMapping>(STARCI_CORE_DNA.intent)
const PlacementContext = createContext<{ readonly placement: ButtonPlacement; readonly navbar: boolean }>({ placement: "decision", navbar: false })

/** Grammar roots select their own declared DNA mapping; nested roots start a fresh decision scope. */
export const ButtonIntentFamilyProvider = ({ family, children }: { readonly family?: string | undefined; readonly children: ReactNode }) => (
    <FamilyContext.Provider value={family === "offset-pop" ? OFFSET_POP_DNA.intent : STARCI_CORE_DNA.intent}>
        <ButtonPlacementProvider placement="decision">{children}</ButtonPlacementProvider>
    </FamilyContext.Provider>
)

/** Placement belongs to the Grammar composition, never to a Button's appearance props. */
export const ButtonPlacementProvider = ({ placement, navbar = false, children }: { readonly placement: ButtonPlacement; readonly navbar?: boolean; readonly children: ReactNode }) => (
    <PlacementContext.Provider value={{ placement, navbar }}>{children}</PlacementContext.Provider>
)

/** Resolve a command's facts through the active family's visual mapping. */
export const useButtonIntentVariant = (intent: ButtonIntent | undefined, step: DestructiveStep | undefined, control: "button" | "iconButton"): ButtonVariant | undefined => {
    const mapping = useContext(FamilyContext)
    const { placement, navbar } = useContext(PlacementContext)
    if (intent === undefined) return undefined
    if (intent === "commit") return mapping.commit[placement]
    if (intent === "neutral") return control === "iconButton"
        ? mapping.neutral.iconButton[navbar ? "navbar" : placement]
        : mapping.neutral.button[placement]
    if (intent === "destructive") return mapping.destructive[step ?? "entry"]
    return mapping[intent]
}
