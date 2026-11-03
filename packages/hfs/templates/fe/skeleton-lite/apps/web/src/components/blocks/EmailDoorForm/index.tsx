"use client"

import { useLocale, useTranslations } from "next-intl"
import { useEmailDoor } from "@/hooks/emailAuth"
import type { EmailDoorFailure } from "@/hooks/emailAuth"
import { APP_ROUTES } from "@/modules/routes"
import { EmailDoorFormBase } from "./component"
import type { EmailDoorLink } from "./component"

/** The doors the block draws; the confirmation is a button, so the mailbox is confirmed by a person and not by a mail scanner opening the link. */
type FormDoor = "signup" | "resend" | "forgot" | "reset" | "confirm"

/** The door the block draws and, for the two link doors, the token of the link. */
type EmailDoorFormProps = { readonly door: FormDoor; readonly token?: string | undefined }

/** The words of one door. */
interface DoorCopy {
    readonly title: string
    readonly description: string
    readonly submit: string
    readonly done: string
    readonly name: string | undefined
    readonly email: string | undefined
    readonly password: string | undefined
}

/** The value of a field of the submitted form, or undefined when it is missing. */
const fieldOf = (input: FormData, name: string): string | undefined => {
    const value = input.get(name)
    return typeof value === "string" ? value : undefined
}

/** The full name of the submitted form: left blank, the door is sent none. */
const nameOf = (input: FormData): string | undefined => {
    const value = fieldOf(input, "name")?.trim()
    return value === undefined || value === "" ? undefined : value
}

/** The language a mail is written in: the page's, when the back end writes mail in it. */
const languageOf = (locale: string): "vi" | "en" | undefined => (locale === "vi" || locale === "en" ? locale : undefined)

/** One email door of the lite sign-in as a form: sign up, resend the confirmation, forgot the password, or choose a new one from a link. */
export const EmailDoorForm = (props: EmailDoorFormProps) => {
    const t = useTranslations("app.emailAuth")
    const locale = useLocale()
    const { failure, done, pending, submit, reject } = useEmailDoor(props.door)
    const copy = {
        signup: { title: t("signup.title"), description: t("signup.description"), submit: t("signup.submit"), done: t("signup.done"), name: t("name"), email: t("email"), password: t("password") },
        resend: { title: t("resend.title"), description: t("resend.description"), submit: t("resend.submit"), done: t("resend.done"), name: undefined, email: t("email"), password: undefined },
        forgot: { title: t("forgot.title"), description: t("forgot.description"), submit: t("forgot.submit"), done: t("forgot.done"), name: undefined, email: t("email"), password: undefined },
        confirm: { title: t("confirm.title"), description: t("confirm.description"), submit: t("confirm.submit"), done: t("confirm.done"), name: undefined, email: undefined, password: undefined },
        reset: { title: t("reset.title"), description: t("reset.description"), submit: t("reset.submit"), done: t("reset.done"), name: undefined, email: undefined, password: t("newPassword") },
    } satisfies Record<FormDoor, DoorCopy>
    const links = {
        signup: [{ href: APP_ROUTES.home, label: t("toSignIn") }, { href: APP_ROUTES.resend, label: t("toResend") }],
        resend: [{ href: APP_ROUTES.home, label: t("toSignIn") }],
        forgot: [{ href: APP_ROUTES.home, label: t("toSignIn") }],
        reset: [{ href: APP_ROUTES.home, label: t("toSignIn") }, { href: APP_ROUTES.forgot, label: t("toForgot") }],
        confirm: [{ href: APP_ROUTES.home, label: t("toSignIn") }, { href: APP_ROUTES.resend, label: t("toResend") }],
    } satisfies Record<FormDoor, readonly EmailDoorLink[]>
    const failures = {
        invalid: t("errors.invalid"),
        password: t("errors.password"),
        link: t("errors.link"),
        tooMany: t("errors.tooMany"),
        unavailable: t("errors.unavailable"),
    } satisfies Record<EmailDoorFailure, string>
    const chosen = copy[props.door]
    const onSubmit = (input: FormData) => {
        const email = fieldOf(input, "email")
        const password = fieldOf(input, "password")
        if ((chosen.email !== undefined && email === undefined) || (chosen.password !== undefined && password === undefined)) reject()
        else submit({ email, password, name: chosen.name === undefined ? undefined : nameOf(input), token: props.token, language: languageOf(locale) })
    }
    return (
        <EmailDoorFormBase
            props={{
                title: chosen.title,
                description: chosen.description,
                nameLabel: chosen.name,
                emailLabel: chosen.email,
                passwordLabel: chosen.password,
                submitLabel: chosen.submit,
                pending,
                errorMessage: failure === undefined ? undefined : failures[failure],
                doneMessage: done ? chosen.done : undefined,
                links: links[props.door],
            }}
            on={{ submit: onSubmit }}
        />
    )
}
