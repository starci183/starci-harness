import { renderTransactional } from "@modules/integrations/mail"
import type { MailLanguage, RenderedMail } from "@modules/integrations/mail"

/** What a confirmation or reset mail is drawn from. */
export interface LinkMailInput {
    /** The product name in the header. */
    readonly brand: string
    /** The absolute link the button opens. */
    readonly url: string
    /** How many hours the link lives. */
    readonly hours: number
}

interface LinkCopy {
    readonly subject: string
    readonly paragraphs: (input: LinkMailInput) => ReadonlyArray<string>
    readonly button: string
    readonly footer: string
}

const CONFIRM: Record<MailLanguage, LinkCopy> = {
    vi: {
        subject: "Xác nhận email của bạn",
        paragraphs: ({ brand, hours }) => [
            `Cảm ơn bạn đã đăng ký ${brand}.`,
            `Nhấn nút bên dưới để xác nhận email. Liên kết có hiệu lực trong ${String(hours)} giờ và chỉ dùng được một lần.`,
        ],
        button: "Xác nhận email",
        footer: "Nếu bạn không đăng ký, hãy bỏ qua thư này.",
    },
    en: {
        subject: "Confirm your email",
        paragraphs: ({ brand, hours }) => [
            `Thanks for signing up to ${brand}.`,
            `Press the button below to confirm your email. The link works once and lasts ${String(hours)} hours.`,
        ],
        button: "Confirm email",
        footer: "If you did not sign up, ignore this message.",
    },
}

const RESET: Record<MailLanguage, LinkCopy> = {
    vi: {
        subject: "Đặt lại mật khẩu",
        paragraphs: ({ hours }) => [
            "Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn.",
            `Nhấn nút bên dưới để chọn mật khẩu mới. Liên kết có hiệu lực trong ${String(hours)} giờ và chỉ dùng được một lần.`,
        ],
        button: "Đặt lại mật khẩu",
        footer: "Nếu bạn không yêu cầu, hãy bỏ qua thư này; mật khẩu của bạn không thay đổi.",
    },
    en: {
        subject: "Reset your password",
        paragraphs: ({ hours }) => [
            "We received a request to reset the password of your account.",
            `Press the button below to choose a new password. The link works once and lasts ${String(hours)} hours.`,
        ],
        button: "Reset password",
        footer: "If you did not ask for this, ignore this message; your password stays as it is.",
    },
}

const draw = (copy: LinkCopy, lang: MailLanguage, input: LinkMailInput): RenderedMail =>
    renderTransactional({
        lang,
        subject: copy.subject,
        brand: { name: input.brand },
        paragraphs: copy.paragraphs(input),
        action: { label: copy.button, url: input.url },
        footer: copy.footer,
    })

/** The mail that carries the link confirming a mailbox. */
export const confirmEmailMail = (lang: MailLanguage, input: LinkMailInput): RenderedMail =>
    draw(CONFIRM[lang], lang, input)

/** The mail that carries the link choosing a new password. */
export const resetPasswordMail = (lang: MailLanguage, input: LinkMailInput): RenderedMail =>
    draw(RESET[lang], lang, input)
