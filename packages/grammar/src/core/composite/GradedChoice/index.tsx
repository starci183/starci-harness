"use client"

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { withRegionInert } from "../../regionScope.js"
import { Icon } from "../../leaf/Icon/index.js"
import { glyphSource } from "../../leaf/Icon/glyphs.js"
import type { NoChildren } from "../../tier.js"

/** One answer of a graded question. */
export type GradedChoiceOption = {
    readonly id: string
    /** The answer as the learner reads it. */
    readonly label: ReactNode
    /** Whether this answer is the right one. Local grading only: a server-graded question never sends it to the browser. */
    readonly isCorrect?: boolean
    /** Why it is right or wrong, shown under the answer once it is picked (local grading). */
    readonly explanation?: ReactNode
}

/**
 * What the server answered for one answer (server grading, 0.55.1): `wrong` a pick graded wrong, `correct` the right pick, `reason` an
 * answer the learner never picked whose reason the right pick released. Each carries its one-sentence reason.
 */
export type GradedChoiceVerdict = {
    readonly state: "wrong" | "correct" | "reason"
    readonly explanation?: ReactNode
}

/** The words of the question, in the app's language. English defaults. */
export type GradedChoiceLabels = {
    /** The verdict over a wrong pick's explanation. */
    readonly wrong: string
    /** The verdict over the right pick's explanation. */
    readonly correct: string
    /** Server grading: the mark over the reason of an answer never picked, once the question is solved. */
    readonly whyNot: string
    /** Server grading: the mark on the answer being graded. */
    readonly grading: string
}

type GradedChoiceCommon = NoChildren & {
    /** Names the group of answers for assistive technology (the question, or "Choose an answer"). */
    readonly label: string
    readonly options: readonly GradedChoiceOption[]
    /** The keys drawn before the answers, in order. Default A, B, C, ... */
    readonly keys?: readonly string[]
    readonly labels?: Partial<GradedChoiceLabels>
}

/** Local grading: every answer carries `isCorrect` and its explanation; the component grades each pick itself. */
export type GradedChoiceLocalProps = GradedChoiceCommon & {
    readonly grading?: "local"
    /** The answers picked so far, in order. Controlled with `onPicksChange`; omit for uncontrolled use from `defaultPicks`. */
    readonly picks?: readonly string[]
    readonly defaultPicks?: readonly string[]
    readonly onPicksChange?: (picks: readonly string[]) => void
    /** Called on each pick with whether it was right. */
    readonly onPick?: (id: string, isCorrect: boolean) => void
    readonly verdicts?: never
    readonly pendingId?: never
}

/**
 * Server grading (0.55.1, owner 2026-11-23): the answer key never reaches the browser. A pick calls `onPick`; the app sends it, marks it
 * `pendingId` while it is graded (every other answer waits), and passes back what the server answered in `verdicts`, by answer id. A
 * wrong verdict locks that answer with its reason; a correct one solves the question, and the answers never picked dim, each with its
 * `reason` verdict once the server released it.
 */
export type GradedChoiceServerProps = GradedChoiceCommon & {
    readonly grading: "server"
    readonly verdicts: Readonly<Record<string, GradedChoiceVerdict>>
    /** The answer being graded now; undefined when none is. */
    readonly pendingId?: string
    readonly onPick: (id: string) => void
    readonly picks?: never
    readonly defaultPicks?: never
    readonly onPicksChange?: never
}

export type GradedChoiceProps = GradedChoiceLocalProps | GradedChoiceServerProps

const LABELS: GradedChoiceLabels = { wrong: "Not quite", correct: "Correct", whyNot: "Why not", grading: "Checking" }
const KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")
const NO_VERDICTS: Readonly<Record<string, GradedChoiceVerdict>> = {}

type OptionState = "open" | "wrong" | "correct" | "spent" | "pending"

/**
 * COMPOSITE - `GradedChoice`: a question a learner answers until they find the right answer (owner 2026-11-23, a lesson's question). Each
 * answer is a large plate with its key. A wrong pick locks that answer in the danger tone with its reason under it, and the learner picks
 * again; the right pick turns success with its reason, and every answer still open dims and locks. Grading is local (`isCorrect` on each
 * answer) or, with `grading="server"`, the server's: the app passes the verdicts it received, so no answer key is in the browser before a
 * pick. Each answer is a real button (a locked one `aria-disabled`, its verdict and reason part of its name): Tab and the arrow keys move
 * between them, Enter or Space picks, and the verdict is announced politely.
 * Contract: A11Y-2 (the group is named, each answer by its words), FOCUS-1, STATE-7 (controlled picks or verdicts).
 */
const GradedChoiceInner = (props: GradedChoiceProps) => {
    const { label, options, keys = KEYS, labels } = props
    const words = { ...LABELS, ...labels }
    const isServer = props.grading === "server"
    const verdicts = props.grading === "server" ? props.verdicts : NO_VERDICTS
    const pendingId = props.grading === "server" ? props.pendingId : undefined
    const [ownPicks, setOwnPicks] = useState<readonly string[]>(props.grading === "server" ? [] : (props.defaultPicks ?? []))
    const picked = props.grading === "server" ? [] : (props.picks ?? ownPicks)
    const [announcement, setAnnouncement] = useState("")
    const buttons = useRef<Array<HTMLButtonElement | null>>([])
    const isSolved = isServer
        ? Object.values(verdicts).some((verdict) => verdict.state === "correct")
        : options.some((option) => option.isCorrect === true && picked.includes(option.id))

    // A server verdict arrives after the pick: announce each new wrong or correct one once.
    const seen = useRef<Readonly<Record<string, GradedChoiceVerdict>>>(verdicts)
    useEffect(() => {
        if (!isServer) return
        const fresh = Object.entries(verdicts).find(([id, verdict]) => seen.current[id] === undefined && verdict.state !== "reason")
        seen.current = verdicts
        if (fresh !== undefined) setAnnouncement(fresh[1].state === "correct" ? words.correct : words.wrong)
    }, [isServer, verdicts, words.correct, words.wrong])

    const stateOf = (option: GradedChoiceOption): OptionState => {
        if (isServer) {
            const verdict = verdicts[option.id]
            if (verdict?.state === "wrong" || verdict?.state === "correct") return verdict.state
            if (isSolved) return "spent"
            if (pendingId === option.id) return "pending"
            return pendingId === undefined ? "open" : "spent"
        }
        if (picked.includes(option.id)) return option.isCorrect === true ? "correct" : "wrong"
        return isSolved ? "spent" : "open"
    }

    const pick = (option: GradedChoiceOption) => {
        if (stateOf(option) !== "open") return
        if (props.grading === "server") {
            props.onPick(option.id)
            setAnnouncement(words.grading)
            return
        }
        const next = [...picked, option.id]
        if (props.picks === undefined) setOwnPicks(next)
        props.onPicksChange?.(next)
        const isCorrect = option.isCorrect === true
        props.onPick?.(option.id, isCorrect)
        setAnnouncement(isCorrect ? words.correct : words.wrong)
    }

    const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0
        const target = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : step === 0 ? null : (index + step + options.length) % options.length
        if (target === null) return
        event.preventDefault()
        buttons.current[target]?.focus()
    }

    return (
        <div
            className="starci-core-graded-choice"
            data-component="GradedChoice"
            data-tier="composite"
            data-contract="A11Y-2 FOCUS-1 STATE-7"
            data-grammar-graded-solved={isSolved ? "true" : "false"}
            data-grammar-graded-grading={isServer ? "server" : "local"}
            aria-busy={pendingId === undefined ? undefined : true}
        >
            <div role="group" aria-label={label} className="starci-core-graded-choice-options">
                {options.map((option, index) => {
                    const state = stateOf(option)
                    const explanation = isServer ? verdicts[option.id]?.explanation : option.explanation
                    const reason = state === "spent" && isServer && verdicts[option.id]?.state === "reason" ? explanation : undefined
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
                                        {explanation === undefined ? null : <span className="starci-core-graded-option-explanation">{explanation}</span>}
                                    </span>
                                ) : null}
                                {reason === undefined ? null : (
                                    <span className="starci-core-graded-option-why">
                                        <span className="starci-core-graded-option-verdict">{words.whyNot}</span>
                                        <span className="starci-core-graded-option-explanation">{reason}</span>
                                    </span>
                                )}
                                {state === "pending" ? <span className="starci-core-graded-option-verdict">{words.grading}</span> : null}
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
