// Managed by starci app sync (slot be.identity.sign-in); do not edit: run "npx starci app sync --execute".
import { Injectable } from "@nestjs/common"
import { IsNull, MoreThan, type EntityManager } from "typeorm"
import {
    AuthError,
    digestOf,
    isAcceptablePassword,
    normalizeEmail,
    type AuthPasswords,
    type SignInBudget,
} from "@modules/integrations/passport"
import {
    InjectMailSettings,
    InjectMailer,
    type MailLanguage,
    type MailOptions,
    type Mailer,
} from "@modules/integrations/mail"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { InjectIds, type Ids } from "@modules/platform/ids"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { IdentityError, IdentityErrorCode } from "./errors/identity.error"
import { InjectAuthPasswords, InjectSignInBudget } from "./identity.decorators"
import { IdentityEmailLogEvent } from "./identity-email.log-events"
import { confirmEmailMail, resetPasswordMail } from "./messages/identity-mail.messages"
import { accountDoors } from "./persistence/account-doors.port"
import { IdentityEmailTokenEntity } from "./persistence/entities"
import { IdentitySessionStoreService } from "./session-store.service"

const CONFIRM = "confirm"
const RESET = "reset"
const SECONDS_PER_HOUR = 3600
/** The session id no session has: closing every session "but" it closes them all. */
const NO_SESSION = "00000000-0000-0000-0000-000000000000"

type Purpose = typeof CONFIRM | typeof RESET

/** The languages the mails are written in. */
const LANGUAGES: ReadonlyArray<MailLanguage> = ["vi", "en"]

@Injectable()
/**
 * The email doors of sign-in: sign up, confirm the mailbox, resend the confirmation, forget and reset the password. A link is a
 * random single-use token that expires and is kept only as its digest; every request counts against the address's budget and a
 * request never says whether an address has an account.
 */
export class IdentityEmailService {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectAuthPasswords() private readonly passwords: AuthPasswords,
        @InjectSignInBudget() private readonly budget: SignInBudget,
        @InjectMailer() private readonly mailer: Mailer,
        @InjectMailSettings() private readonly options: MailOptions,
        @InjectClock() private readonly clock: Clock,
        @InjectIds() private readonly ids: Ids,
        @InjectLogger() private readonly logger: Logger,
        private readonly sessions: IdentitySessionStoreService,
    ) {}

    /**
     * Creates an unconfirmed password account, its full name (when given) in the profile keys a Google sign-in fills too, and mails the
     * confirmation link; an address that already has an account is answered the same way and its profile is left as it is.
     */
    async signup(email: string, password: string, language?: string, name?: string): Promise<void> {
        const address = normalizeEmail(email)
        await this.admit("signup", address)
        if (!isAcceptablePassword(password)) throw new IdentityError({ code: IdentityErrorCode.PasswordInvalid })
        const known = await accountDoors.userByEmail(this.entityManager, address)
        if (known !== undefined) {
            if (known.email_confirmed_at === null) await this.sendConfirmation(known.id, address, language)
            return
        }
        const now = this.clock.now()
        const id = this.ids.next()
        const hash = await this.passwords.hash(password)
        const created = await accountDoors.createUser(this.entityManager, {
            id,
            email: address,
            hash,
            confirmed: false,
            meta: JSON.stringify(name === undefined ? {} : { full_name: name, name }),
            now,
        })
        await this.sendConfirmation(created ?? id, address, language)
    }

    /** Mails a new confirmation link to an unconfirmed account; any other address is answered the same way. */
    async resend(email: string, language?: string): Promise<void> {
        const address = normalizeEmail(email)
        await this.admit("signup", address)
        const user = await accountDoors.userByEmail(this.entityManager, address)
        if (user?.email_confirmed_at !== null || user.encrypted_password === null) return
        await this.sendConfirmation(user.id, address, language)
    }

    /** Spends a confirmation link: the mailbox becomes confirmed. */
    async confirm(token: string): Promise<void> {
        const now = this.clock.now()
        await this.entityManager.transaction(async (scoped) => {
            const row = await this.spendable(scoped, token, CONFIRM, now)
            await scoped.update(
                IdentityEmailTokenEntity,
                { userId: row.userId, purpose: CONFIRM, usedAt: IsNull() },
                { usedAt: now },
            )
            await accountDoors.confirmUser(scoped, row.userId, now)
        })
    }

    /** Mails a reset link when the address has a live password account; the answer never says whether it does. */
    async forgot(email: string, language?: string): Promise<void> {
        const address = normalizeEmail(email)
        await this.admit("reset", address)
        const user = await accountDoors.userByEmail(this.entityManager, address)
        if (user === undefined || user.disabled) return
        const token = await this.mint(user.id, RESET, this.options.resetTtlSeconds)
        const url = `${this.options.webOrigin}/auth/reset?token=${encodeURIComponent(token)}`
        const mail = resetPasswordMail(this.languageOf(language), {
            brand: this.options.brandName,
            url,
            hours: this.hoursOf(this.options.resetTtlSeconds),
        })
        await this.deliver(address, mail, RESET)
    }

    /** Spends a reset link: sets the new password, confirms the mailbox (the link proved it) and ends every session of the person. */
    async reset(token: string, password: string): Promise<void> {
        if (!isAcceptablePassword(password)) throw new IdentityError({ code: IdentityErrorCode.PasswordInvalid })
        const now = this.clock.now()
        const hash = await this.passwords.hash(password)
        const userId = await this.entityManager.transaction(async (scoped) => {
            const row = await this.spendable(scoped, token, RESET, now)
            await scoped.update(IdentityEmailTokenEntity, { userId: row.userId, usedAt: IsNull() }, { usedAt: now })
            await accountDoors.setPassword(scoped, row.userId, hash, true, now)
            return row.userId
        })
        await this.sessions.closeOtherSessions(userId, NO_SESSION)
    }

    private async admit(kind: "signup" | "reset", address: string): Promise<void> {
        try {
            await this.budget.admit(kind, address)
        } catch (cause) {
            if (cause instanceof AuthError) throw new IdentityError({ code: IdentityErrorCode.TooManyAttempts, cause })
            throw cause
        }
    }

    private async spendable(
        scoped: EntityManager,
        token: string,
        purpose: Purpose,
        now: Date,
    ): Promise<IdentityEmailTokenEntity> {
        const row = await scoped.findOne(IdentityEmailTokenEntity, {
            where: { tokenHash: digestOf(token), purpose, usedAt: IsNull(), expiresAt: MoreThan(now) },
            lock: { mode: "pessimistic_write" },
        })
        if (row === null) throw new IdentityError({ code: IdentityErrorCode.ResetTokenInvalid })
        return row
    }

    /** The language a request named when it is one the mails are written in, else the default of the settings. */
    private languageOf(language: string | undefined): MailLanguage {
        return LANGUAGES.find((candidate) => candidate === language) ?? this.options.defaultLanguage
    }

    private async sendConfirmation(userId: string, address: string, language: string | undefined): Promise<void> {
        const token = await this.mint(userId, CONFIRM, this.options.confirmTtlSeconds)
        const url = `${this.options.webOrigin}/auth/confirm?token=${encodeURIComponent(token)}`
        const mail = confirmEmailMail(this.languageOf(language), {
            brand: this.options.brandName,
            url,
            hours: this.hoursOf(this.options.confirmTtlSeconds),
        })
        await this.deliver(address, mail, CONFIRM)
    }

    /** Stores a fresh token (older live ones of the same purpose stop working) and answers the plain token for the one link that carries it. */
    private async mint(userId: string, purpose: Purpose, ttlSeconds: number): Promise<string> {
        const now = this.clock.now()
        const token = `${this.ids.next()}${this.ids.next()}`.replaceAll("-", "")
        await this.entityManager.transaction(async (scoped) => {
            await scoped.update(IdentityEmailTokenEntity, { userId, purpose, usedAt: IsNull() }, { usedAt: now })
            await scoped.insert(IdentityEmailTokenEntity, {
                id: this.ids.next(),
                userId,
                purpose,
                tokenHash: digestOf(token),
                expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
                usedAt: null,
                createdAt: now,
            })
        })
        return token
    }

    private async deliver(to: string, message: Parameters<Mailer["send"]>[0]["message"], kind: Purpose): Promise<void> {
        try {
            await this.mailer.send({ to, message })
        } catch (cause) {
            this.logger.error(IdentityEmailLogEvent.MailFailed, cause, { kind })
        }
    }

    private hoursOf(seconds: number): number {
        return Math.max(1, Math.ceil(seconds / SECONDS_PER_HOUR))
    }
}
