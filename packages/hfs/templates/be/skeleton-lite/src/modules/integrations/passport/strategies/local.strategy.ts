import { Injectable } from "@nestjs/common"
import { PassportStrategy } from "@nestjs/passport"
import { Strategy } from "passport-local"
import { PassportError, PassportErrorCode } from "../errors/passport.error"
import { InjectPasswordAccounts } from "../passport.decorators"
import { verifyPassword } from "../passport.password"

/** The account a password sign-in proves. */
export interface PasswordAccount {
    /** The user id (auth.users.id). */
    readonly id: string
    /** The account email. */
    readonly email: string
    /** The stored bcrypt hash (auth.users.encrypted_password), null for an account without a password. */
    readonly passwordHash: string | null
}

/** The lookup the identity domain provides: the account of one email, or undefined. */
export type FindPasswordAccount = (email: string) => Promise<PasswordAccount | undefined>

@Injectable()
/** Email and password sign-in: bcrypt against the stored hash; a miss and a wrong password fail alike. */
export class LocalStrategy extends PassportStrategy(Strategy, "local") {
    constructor(@InjectPasswordAccounts() private readonly findAccount: FindPasswordAccount) {
        super({ usernameField: "email", passwordField: "password" })
    }

    /** The proven account; every refusal is the same error so an email's existence never leaks. */
    async validate(email: string, password: string): Promise<{ readonly id: string; readonly email: string }> {
        const account = await this.findAccount(email.trim().toLowerCase())
        if (!(await verifyPassword(password, account?.passwordHash ?? null)) || account === undefined) {
            throw new PassportError({ code: PassportErrorCode.CredentialsRefused })
        }
        return { id: account.id, email: account.email }
    }
}
