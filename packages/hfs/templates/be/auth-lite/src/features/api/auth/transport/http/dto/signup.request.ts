// Managed by starci app sync (slot be.feature.auth); do not edit: run "npx starci app sync --execute".
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator"
import type { MailLanguage } from "@modules/integrations/mail"

/** The posted sign-up data. */
export class SignupRequest {
    /** The sign-in address. */
    @IsEmail()
    @MaxLength(254)
    email!: string

    /** The password. */
    @IsString()
    @MinLength(1)
    @MaxLength(128)
    password!: string

    /** The language of the mail; the app's default when left out. */
    @IsOptional()
    @IsIn(["vi", "en"])
    language?: MailLanguage
}
