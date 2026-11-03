"use client"

import { useState, useTransition } from "react"
import { sendEmailDoor } from "@/modules/auth"
import type { EmailDoorName } from "@/modules/auth"
import { failureOf } from "./emailAuth.shared"
import type { EmailDoorFailure } from "./emailAuth.shared"

export type { EmailDoorFailure } from "./emailAuth.shared"

/** What an email door hook answers: whether a request runs, whether the back end accepted it, why it refused, the call itself and `reject`. */
export interface EmailDoor {
    readonly failure: EmailDoorFailure | undefined
    readonly done: boolean
    readonly pending: boolean
    readonly submit: (body: Readonly<Record<string, string | undefined>>) => void
    readonly reject: () => void
}

/** Calls one email door of the back end through modules/auth; a success sets `done`, a refusal its failure. */
export const useEmailDoor = (door: EmailDoorName): EmailDoor => {
    const [failure, setFailure] = useState<EmailDoorFailure>()
    const [done, setDone] = useState(false)
    const [pending, startTransition] = useTransition()
    const submit = (body: Readonly<Record<string, string | undefined>>): void =>
        startTransition(async () => {
            const failed = await sendEmailDoor(door, body)
            setFailure(failed === undefined ? undefined : failureOf(failed))
            setDone(failed === undefined)
        })
    return { failure, done, pending, submit, reject: (): void => setFailure("invalid") }
}
