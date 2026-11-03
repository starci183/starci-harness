import { resolveMailOptions } from "./options.ts"
import type { MailOptions } from "./options.ts"
import type { Mailer } from "./port.ts"
import { MailService } from "./service.ts"
import { SmtpTransport } from "./smtp.ts"

/** The port over SMTP for plain Node (a script, a worker); a Nest app registers `MailModule` instead. */
export const createMailer = (options: MailOptions): Mailer & { onModuleDestroy(): void } => {
    const resolved = resolveMailOptions(options)
    return new MailService(new SmtpTransport(resolved), resolved)
}

export { MailModule } from "./mail.module.ts"
export type { MailModuleExtras, MailRegisterAsyncOptions, MailRegisterOptions } from "./mail.module.ts"
export { MAILER } from "./tokens.ts"
export { MAIL_ERROR_CODES, MAIL_ERROR_KINDS, MailError } from "./errors.ts"
export type { MailErrorCode, MailErrorKind } from "./errors.ts"
export {
    DEFAULT_CONNECTION_TIMEOUT_MS,
    DEFAULT_GREETING_TIMEOUT_MS,
    DEFAULT_MAX_BODY_BYTES,
    DEFAULT_MAX_RECIPIENTS,
    DEFAULT_SEND_TIMEOUT_MS,
    DEFAULT_SOCKET_TIMEOUT_MS,
} from "./options.ts"
export type { MailAuth, MailOptions, MailSecurity, MailSender, SecretInput } from "./options.ts"
export type { MailMessage, Mailer, RenderedMail, SendMailRequest, SentMail } from "./port.ts"
export { isValidMailbox } from "./policy.ts"
export { DEFAULT_ACCENT, SafeHtml, escapeHtml, html, oneLine, raw, renderTransactional, safeUrl } from "./render.ts"
export type { HtmlValue, MailAction, MailBrand, TransactionalMail } from "./render.ts"
export { MailService } from "./service.ts"
export { classifySmtpFailure } from "./smtp.ts"
export type { MailEnvelope, MailTransport } from "./transport.ts"
