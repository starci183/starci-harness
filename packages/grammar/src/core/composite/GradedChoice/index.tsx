"use client"

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { withRegionInert } from "../../regionScope.js"
import { Icon } from "../../leaf/Icon/index.js"
import { glyphSource } from "../../leaf/Icon/glyphs.js"
import type { NoChildren } from "../../tier.js"

/** One answer of a graded question. */
export type GradedChoiceOption = {
    readonly id: string
    /** The answer as the learner reads it. */
    readonly label: ReactNode
    /** Whether this answer is the right one. */
    readonly isCorrect: boolean
    /** Why it is right or wrong, shown under the answer once it is picked. */
    readonly explanation?: ReactNode
}

/** The words of the question, in the app's language. English defaults. */
export type GradedChoiceLabels = {
    /** The verdict over a wrong pick's explanation. */
    readonly wrong: string
    /** The verdict over the right pick's explanation. */
    readonly correct: string
}

export type GradedChoiceProps = NoChildren & {
    /** Names the group of answers for assistive technology (the question, or "Choose an answer"). */
    readonly label: string
    readonly options: readonly GradedChoiceOption[]
    /** The keys drawn before the answers, in order. Default A, B, C, ... */
    readonly keys?: readonly string[]
    /** The answers picked so far, in order. Controlled with `onPicksChange`; omit for uncontrolled use from `defaultPicks`. */
    readonly picks?: readonly string[]
    readonly defaultPicks?: readonly string[]
    readonly onPicksChange?: (picks: readonly string[]) => void
    /** Called on each pick with whether it was right. */
    readonly onPick?: (id: string, isCorrect: boolean) => void
    readonly labels?: Partial<GradedChoiceLabels>
}

const LABELS: GradedChoiceLabels = { wrong: "Not quite", correct: "Correct" }
const KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")

type OptionState = "open" | "wrong" | "correct" | "spent"

/**
 * COMPOSITE - `GradedChoice`: a question a learner answers until they find the right answer (owner 2026-11-23, a lesson's question). Each
 * answer is a large plate with its key. A wrong pick locks that answer in the danger tone with its reason under it, and the learner picks
 * again; the right pick turns success with its reason, and every answer still open dims and locks. Each answer is a real button (a
 * locked one `aria-disabled`, its verdict and reason part of its name): Tab and the arrow keys move between them, Enter or Space picks, and the verdict is announced politely.
 * Contract: A11Y-2 (the group is named, each answer by its words), FOCUS-1, STATE-7 (controlled picks).
 */
const GradedChoiceInner = ({ label, options, keys = KEYS, picks, defaultPicks, onPicksChange, onPick, labels }: GradedChoiceProps) => {
    const words = { ...LABELS, ...labels }
    const [ownPicks, setOwnPicks] = useState<readonly string[]>(defaultPicks ?? [])
    const picked = picks ?? ownPicks
    const [announcement, setAnnouncement] = useState("")
    const buttons = useRef<Array<HTMLButtonElement | null>>([])
    const isSolved = options.some((option) => option.isCorrect && picked.includes(option.id))

    const stateOf = (option: GradedChoiceOption): OptionState => {
        if (picked.includes(option.id)) return option.isCorrect ? "correct" : "wrong"
        return isSolved ? "spent" : "open"
    }

    const pick = (option: GradedChoiceOption) => {
        if (stateOf(option) !== "open") return
        const next = [...picked, option.id]
        if (picks === undefined) setOwnPicks(next)
        onPicksChange?.(next)
        onPick?.(option.id, option.isCorrect)
        setAnnouncement(option.isCorrect ? words.correct : words.wrong)
    }

    const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0
        const target = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : step === 0 ? null : (index + step + options.length) % options.length
        if (target === null) return
        event.preventDefault()
        buttons.current[target]?.focus()
    }

    return (
        <div className="starci-core-graded-choice" data-component="GradedChoice" data-tier="composite" data-contract="A11Y-2 FOCUS-1 STATE-7" data-grammar-graded-solved={isSolved ? "true" : "false"}>
            <div role="group" aria-label={label} className="starci-core-graded-choice-options">
                {options.map((option, index) => {
                    const state = stateOf(option)
                    return (
                        <button
                            key={option.id}
                            ref={(node) => { buttons.current[index] = node }}
                            type="button"
                            className="starci-core-graded-option"
                            data-grammar-graded-state={state}
                            aria-disabled={state === "open" ? undefined : true}
                            onClick={() => pick(option)}
                            onKeyDown={(event) => onKeyDown(event, index)}
                        >
                            <span className="starci-core-graded-option-key" aria-hidden="true">
                                {keys[index] ?? String(index + 1)}
                            </span>
                            <span className="starci-core-graded-option-main">
                                <span className="starci-core-graded-option-label">{option.label}</span>
                                {state === "wrong" || state === "correct" ? (
                                    <span className="starci-core-graded-option-why">
                                        <span className="starci-core-graded-option-verdict">
                                            <Icon source={glyphSource(state === "correct" ? "success" : "close")} usage="text" />
                                            {state === "correct" ? words.correct : words.wrong}
                                        </span>
                                        {option.explanation === undefined ? null : <span className="starci-core-graded-option-explanation">{option.explanation}</span>}
                                    </span>
                                ) : null}
                            </span>
                        </button>
                    )
                })}
            </div>
            <span role="status" className="starci-core-nav-visually-hidden">{announcement}</span>
        </div>
    )
}

/** Inside a loading region the answers wait inert: a question is never answered before it is read. */
export const GradedChoice = withRegionInert(GradedChoiceInner)
