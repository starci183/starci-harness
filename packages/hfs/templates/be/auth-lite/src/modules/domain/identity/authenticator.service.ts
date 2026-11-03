// Managed by starci app sync (slot be.identity.sign-in); do not edit: run "npx starci app sync --execute".
import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { PassportError, PassportErrorCode, isPresentablePassword, normalizeEmail } from "@modules/integrations/passport"
import type { AuthAuthenticator, AuthPasswords, AuthSubject, GoogleProfile, SignInBudget } from "@modules/integrations/passport"
import { InjectClock } from "@modules/platform/clock"
import type { Clock } from "@modules/platform/clock"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { InjectIds } from "@modules/platform/ids"
import type { Ids } from "@modules/platform/ids"
import { isDisabled } from "./account-directory.service"
import { IdentityError, IdentityErrorCode } from "./errors/identity.error"
import { InjectAuthPasswords, InjectSignInBudget } from "./identity.decorators"
import { AuthIdentityEntity, AuthUserEntity } from "./persistence/entities"

const GOOGLE = "google"

@Injectable()
/** The two sign-in decisions: is this email and password right, and which account does this Google profile stand for. */
export class IdentityAuthenticatorService implements AuthAuthenticator {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectAuthPasswords() private readonly passwords: AuthPasswords,
        @InjectSignInBudget() private readonly budget: SignInBudget,
        @InjectClock() private readonly clock: Clock,
        @InjectIds() private readonly ids: Ids,
    ) {}

    /** Verifies the pair. An unknown address and a wrong password answer the same refusal; only wrong passwords count against the budget. */
    async verifyPassword(email: string, password: string): Promise<AuthSubject> {
        const address = normalizeEmail(email)
        const user = await this.budget.counted("login", address, async () => {
            const found = await this.entityManager.findOne(AuthUserEntity, { where: { email: address, isAnonymous: false } })
            const matches = await this.passwords.verify(isPresentablePassword(password) ? password : "", found?.encryptedPassword ?? "")
            return { passed: found !== null && matches, value: found !== null && matches ? found : null }
        })
        if (user === null) throw new IdentityError({ code: IdentityErrorCode.PairRefused })
        const now = this.clock.now()
        if (isDisabled(user, now)) throw new IdentityError({ code: IdentityErrorCode.AccountDisabled })
        if (user.emailConfirmedAt === null || user.email === null) throw new IdentityError({ code: IdentityErrorCode.EmailNotConfirmed })
        await this.entityManager.update(AuthUserEntity, { id: user.id }, { lastSignInAt: now })
        return { userId: user.id, email: user.email }
    }

    /** Finds the account a Google subject is linked to, else links by a verified email, else creates the account. */
    async signInWithGoogle(profile: GoogleProfile): Promise<AuthSubject> {
        if (profile.email === null || !profile.emailVerified) throw new PassportError({ code: PassportErrorCode.GoogleRejected })
        const address = normalizeEmail(profile.email)
        const now = this.clock.now()
        const user = await this.entityManager.transaction(async (scoped) => {
            const linked = await scoped.findOne(AuthIdentityEntity, { where: { provider: GOOGLE, providerId: profile.subject } })
            const known =
                (linked === null ? null : await scoped.findOne(AuthUserEntity, { where: { id: linked.userId } })) ??
                (await scoped.findOne(AuthUserEntity, { where: { email: address, isAnonymous: false } }))
            const person = known ?? (await this.create(scoped, address, now))
            if (linked === null) {
                await scoped.insert(AuthIdentityEntity, {
                    id: this.ids.next(),
                    providerId: profile.subject,
                    userId: person.id,
                    provider: GOOGLE,
                    identityData: { sub: profile.subject, email: address, name: profile.name, picture: profile.picture, email_verified: true },
                    lastSignInAt: now,
                    createdAt: now,
                    updatedAt: now,
                })
            }
            await scoped.update(AuthUserEntity, { id: person.id }, { lastSignInAt: now, emailConfirmedAt: person.emailConfirmedAt ?? now })
            return person
        })
        if (isDisabled(user, now)) throw new IdentityError({ code: IdentityErrorCode.AccountDisabled })
        return { userId: user.id, email: address }
    }

    private async create(scoped: EntityManager, address: string, now: Date): Promise<AuthUserEntity> {
        const id = this.ids.next()
        await scoped.insert(AuthUserEntity, {
            id,
            aud: "authenticated",
            role: "authenticated",
            email: address,
            encryptedPassword: null,
            emailConfirmedAt: now,
            lastSignInAt: now,
            bannedUntil: null,
            deletedAt: null,
            isAnonymous: false,
            createdAt: now,
            updatedAt: now,
        })
        const created = await scoped.findOne(AuthUserEntity, { where: { id } })
        if (created === null) throw new PassportError({ code: PassportErrorCode.GoogleRejected })
        return created
    }
}
