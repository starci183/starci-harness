// Managed by starci app sync (slot be.identity.sign-in); do not edit: run "npx starci app sync --execute".
import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { PassportError, PassportErrorCode, isPresentablePassword, normalizeEmail } from "@modules/integrations/passport"
import type {
    AuthAuthenticator,
    AuthPasswords,
    AuthSubject,
    GoogleProfile,
    SignInBudget,
} from "@modules/integrations/passport"
import { InjectClock } from "@modules/platform/clock"
import type { Clock } from "@modules/platform/clock"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { InjectIds } from "@modules/platform/ids"
import type { Ids } from "@modules/platform/ids"
import { InjectLogger } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { IdentityError, IdentityErrorCode } from "./errors/identity.error"
import { InjectAuthPasswords, InjectSignInBudget } from "./identity.decorators"
import { IdentitySignInLogEvent } from "./identity-sign-in.log-events"
import { accountDoors, fullNameOf } from "./persistence/account-doors.port"

/** A Google profile whose email Google verified, so it has one. */
type VerifiedProfile = GoogleProfile & { readonly email: string }

/** The profile keys a Google sign-in may fill on the account; they never overwrite what the person already set. */
const profileKeysOf = (profile: VerifiedProfile): Record<string, string | boolean> => ({
    ...(profile.name === null ? {} : { full_name: profile.name, name: profile.name }),
    ...(profile.picture === null ? {} : { avatar_url: profile.picture, picture: profile.picture }),
    email: profile.email,
    email_verified: profile.emailVerified,
})

@Injectable()
/** The two sign-in decisions over the account doors: is this email and password right, and which account does this Google profile stand for. */
export class IdentityAuthenticatorService implements AuthAuthenticator {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectAuthPasswords() private readonly passwords: AuthPasswords,
        @InjectSignInBudget() private readonly budget: SignInBudget,
        @InjectClock() private readonly clock: Clock,
        @InjectIds() private readonly ids: Ids,
        @InjectLogger() private readonly logger: Logger,
    ) {}

    /** Verifies the pair. An unknown address and a wrong password answer the same refusal; only wrong passwords count against the budget. */
    async verifyPassword(email: string, password: string): Promise<AuthSubject> {
        const address = normalizeEmail(email)
        const account = await this.budget.counted("login", address, async () => {
            const found = await accountDoors.userByEmail(this.entityManager, address)
            const matches = await this.passwords.verify(
                isPresentablePassword(password) ? password : "",
                found?.encrypted_password ?? "",
            )
            return { passed: found !== undefined && matches, value: found !== undefined && matches ? found : undefined }
        })
        if (account === undefined) throw new IdentityError({ code: IdentityErrorCode.PairRefused })
        if (account.disabled) throw new IdentityError({ code: IdentityErrorCode.AccountDisabled })
        if (account.email_confirmed_at === null) throw new IdentityError({ code: IdentityErrorCode.EmailNotConfirmed })
        await accountDoors.touchUser(this.entityManager, account.id, this.clock.now(), false, "{}")
        return { userId: account.id, email: account.email }
    }

    /** Finds the account a Google subject is linked to, else links by a verified email, else creates the account. */
    async signInWithGoogle(profile: GoogleProfile): Promise<AuthSubject> {
        if (profile.email === null || !profile.emailVerified)
            throw new PassportError({ code: PassportErrorCode.GoogleRejected })
        const address = normalizeEmail(profile.email)
        const verified: VerifiedProfile = { ...profile, email: profile.email }
        const now = this.clock.now()
        const userId = await this.entityManager.transaction(async (scoped) => {
            const linked = await accountDoors.userByGoogle(scoped, profile.subject)
            const byEmail = linked === null ? await accountDoors.userByEmail(scoped, address) : undefined
            const id = linked ?? byEmail?.id ?? (await this.createFor(scoped, address, verified, now))
            const identityData = {
                sub: profile.subject,
                email: address,
                name: profile.name,
                picture: profile.picture,
                email_verified: true,
            }
            await accountDoors.linkGoogle(scoped, id, profile.subject, JSON.stringify(identityData), now)
            await accountDoors.touchUser(scoped, id, now, true, JSON.stringify(profileKeysOf(verified)))
            return id
        })
        const account = await accountDoors.userById(this.entityManager, userId)
        if (account?.email === undefined || account.email === null)
            throw new PassportError({ code: PassportErrorCode.GoogleRejected })
        if (account.disabled) throw new IdentityError({ code: IdentityErrorCode.AccountDisabled })
        const name = fullNameOf(account.meta)
        return { userId: account.id, email: account.email, ...(name === undefined ? {} : { name }) }
    }

    private async createFor(
        scoped: EntityManager,
        address: string,
        profile: VerifiedProfile,
        now: Date,
    ): Promise<string> {
        const id = this.ids.next()
        const created = await accountDoors.createUser(scoped, {
            id,
            email: address,
            hash: null,
            confirmed: true,
            meta: JSON.stringify(profileKeysOf(profile)),
            now,
        })
        if (created === undefined) throw new PassportError({ code: PassportErrorCode.GoogleRejected })
        this.logger.info(IdentitySignInLogEvent.AccountCreated, { userId: created })
        return created
    }
}
