import { MAILER, type Mailer } from "@starci/mail"
import { injector, type TypedParameterDecorator } from "@modules/platform/composition"
import type { MailOptions } from "./mail.options"

/** Token of the app's mail settings (the brand, the default language, the link lifetimes). */
export const MAIL_SETTINGS: unique symbol = Symbol("integrations.mail.settings")

/** Injects the mail port of `@starci/mail`. Parameter type: Mailer. */
export const InjectMailer = (): TypedParameterDecorator<Mailer> => injector<Mailer>(MAILER)

/** Injects the app's mail settings. Parameter type: MailOptions. */
export const InjectMailSettings = (): TypedParameterDecorator<MailOptions> => injector<MailOptions>(MAIL_SETTINGS)
