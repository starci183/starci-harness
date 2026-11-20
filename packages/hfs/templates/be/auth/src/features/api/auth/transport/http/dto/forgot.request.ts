// Managed by starci app sync (slot be.feature.auth); do not edit: run "npx starci app sync --execute".
import { IsEmail, IsIn, IsOptional, MaxLength } from "class-validator"
import type { MailLanguage } from "@modules/integrations/mail"

/** The posted address of a password reset request. */
export class ForgotRequest {
    /** The sign-in address. */
    @IsEmail()
    @MaxLength(254)
    email!: string

    /** The language of the mail; the app's default when left out. */
    @IsOptional()
    @IsIn(["vi", "en"])
    language?: MailLanguage
}
