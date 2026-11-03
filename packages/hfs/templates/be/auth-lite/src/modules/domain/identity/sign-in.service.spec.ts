// Managed by starci app sync (slot be.identity.sign-in); do not edit: run "npx starci app sync --execute".
import "reflect-metadata"
import { generateKeyPairSync } from "node:crypto"
import { Test } from "@nestjs/testing"
import { FindOperator } from "typeorm"
import { FakeClock } from "@starci/jest-preset"
import {
    PASSPORT_DOORS,
    PASSPORT_PASSWORDS,
    PASSPORT_SESSIONS,
    PassportError,
    PassportErrorCode,
    passportKit,
    passportModule,
} from "@modules/integrations/passport"
import type { AuthPasswords, HttpExchange, PassportOptions, RateCounter } from "@modules/integrations/passport"
import { CLOCK, ClockModule } from "@modules/platform/clock"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { IdsModule } from "@modules/platform/ids"
import { IdentityModule } from "./identity.module"
import { IdentityRateCounterService } from "./rate-counter.service"
import { AuthUserEntity, IdentityRefreshTokenEntity, IdentitySessionEntity } from "./persistence/entities"
import { IdentitySignInService } from "./sign-in.service"

const START = "2026-02-03T04:05:06.000Z"
const COOKIE = "refresh_token"

type Row = Record<string, unknown>

/** True when a stored value satisfies a find criterion: an operator (Not, LessThan) or plain equality. */
const satisfies = (value: unknown, wanted: unknown): boolean => {
    if (!(wanted instanceof FindOperator)) return value === wanted
    const target: unknown = wanted.value
    if (wanted.type === "not") return value !== target
    if (wanted.type === "lessThan") return value instanceof Date && target instanceof Date && value < target
    return false
}

/** The database as the adapters see it, in memory: the tables they write and the foreign key from tokens to sessions. */
class MemoryManager {
    private readonly tables = new Map<unknown, Row[]>()

    rows(entity: unknown): Row[] {
        const found = this.tables.get(entity) ?? []
        this.tables.set(entity, found)
        return found
    }

    findOne(entity: unknown, options: { where: Row }): Promise<Row | null> {
        return Promise.resolve(this.match(entity, options.where)[0] ?? null)
    }

    insert(entity: unknown, values: Row): Promise<void> {
        this.rows(entity).push({ ...values })
        return Promise.resolve()
    }

    update(entity: unknown, criteria: Row, patch: Row): Promise<void> {
        for (const row of this.match(entity, criteria)) Object.assign(row, patch)
        return Promise.resolve()
    }

    delete(entity: unknown, criteria: Row): Promise<void> {
        const doomed = new Set(this.match(entity, criteria))
        this.tables.set(entity, this.rows(entity).filter((row) => !doomed.has(row)))
        if (entity === IdentitySessionEntity) {
            const alive = new Set(this.rows(IdentitySessionEntity).map((row) => row["id"]))
            this.tables.set(IdentityRefreshTokenEntity, this.rows(IdentityRefreshTokenEntity).filter((row) => alive.has(row["sessionId"])))
        }
        return Promise.resolve()
    }

    transaction<T>(work: (scoped: MemoryManager) => Promise<T>): Promise<T> {
        return work(this)
    }

    private match(entity: unknown, where: Row): Row[] {
        return this.rows(entity).filter((row) => Object.entries(where).every(([key, wanted]) => satisfies(row[key], wanted)))
    }
}

/** A counter the spec owns: the adapter over the attempts table has its own spec. */
class MemoryCounter implements RateCounter {
    private readonly hits = new Map<string, number>()

    consume(key: string, _windowMs: number, limit: number): Promise<boolean> {
        const next = (this.hits.get(key) ?? 0) + 1
        this.hits.set(key, next)
        return Promise.resolve(next <= limit)
    }

    clear(key: string): Promise<void> {
        this.hits.delete(key)
        return Promise.resolve()
    }
}

/** One request and response of the doors: the cookies the response writes are kept so the next request can send them back. */
const exchangeOf = (body: Row, cookie?: string): { readonly exchange: HttpExchange; readonly written: Map<string, string> } => {
    const written = new Map<string, string>()
    const req = { headers: { ...(cookie === undefined ? {} : { cookie: COOKIE + "=" + cookie }), "user-agent": "spec" }, body, query: {}, ip: "203.0.113.5" }
    const res = {
        cookie: (name: string, value: string) => written.set(name, value),
        clearCookie: (name: string) => written.set(name, ""),
        once: () => undefined,
    }
    return { exchange: { req, res }, written }
}

const options = (): PassportOptions => {
    const { privateKey } = generateKeyPairSync("ed25519")
    return {
        issuer: "https://api.spec.test",
        audience: undefined,
        keys: [{ privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), keyId: "spec-1" }],
        accessTtlSeconds: 900,
        refreshTtlSeconds: 3600,
        reuseGraceMs: 30_000,
        bcryptCost: 4,
        returnOrigin: "https://app.spec.test",
        google: null,
        cookie: { name: COOKIE },
        budget: { loginAttempts: 3, resetAttempts: 2, windowMs: 900_000 },
    }
}

const boot = async () => {
    const database = new MemoryManager()
    const clock = new FakeClock(START)
    const settings = options()
    const kit = passportKit(settings)
    const moduleRef = await Test.createTestingModule({
        imports: [ClockModule.register({ isGlobal: true }), IdsModule.register({ isGlobal: true }), IdentityModule.register({ isGlobal: true, verifyAccessToken: kit.verify }), passportModule(settings)],
        providers: [{ provide: PRIMARY_ENTITY_MANAGER, useValue: database }],
    })
        .overrideProvider(CLOCK)
        .useValue(clock)
        .overrideProvider(IdentityRateCounterService)
        .useValue(new MemoryCounter())
        .compile()
    await moduleRef.init()
    const passwords = moduleRef.get<AuthPasswords>(PASSPORT_PASSWORDS)
    database.rows(AuthUserEntity).push({
        id: "user-1",
        email: "a@example.test",
        encryptedPassword: await passwords.hash("correct horse"),
        emailConfirmedAt: new Date(START),
        bannedUntil: null,
        deletedAt: null,
        isAnonymous: false,
    })
    return { database, clock, kit, subject: moduleRef.get(IdentitySignInService) }
}

const rejection = async (work: Promise<unknown>): Promise<unknown> => {
    try {
        await work
    } catch (error) {
        return error
    }
    return undefined
}

describe("sign-in: login, an authenticated request, refresh, reuse of the old refresh token, logout", () => {
    it("runs the whole cookie session against the real package and the identity adapters", async () => {
        const { database, clock, kit, subject } = await boot()

        const login = exchangeOf({ email: " A@Example.test ", password: "correct horse" })
        const grant = await subject.login(login.exchange)
        const first = login.written.get(COOKIE) ?? ""

        expect(grant.user).toEqual({ id: "user-1", email: "a@example.test" })
        expect(first).not.toBe("")
        expect(database.rows(IdentitySessionEntity)).toHaveLength(1)
        expect(await kit.verify(grant.accessToken)).toMatchObject({ kind: "ok", value: { id: "user-1", role: "authenticated" } })

        const refreshed = exchangeOf({}, first)
        const next = await subject.refresh(refreshed.exchange)
        const second = refreshed.written.get(COOKIE) ?? ""

        expect(second).not.toBe("")
        expect(second).not.toBe(first)
        expect(next.user.id).toBe("user-1")
        expect((await subject.session(exchangeOf({}, second).exchange)).user.id).toBe("user-1")

        clock.advance(31_000)
        const replay = exchangeOf({}, first)
        const refusal = await rejection(subject.refresh(replay.exchange))

        expect(refusal).toBeInstanceOf(PassportError)
        expect(refusal).toMatchObject({ code: PassportErrorCode.RefreshReused })
        expect(replay.written.get(COOKIE)).toBe("")
        expect(database.rows(IdentitySessionEntity)).toHaveLength(0)
        expect(await rejection(subject.refresh(exchangeOf({}, second).exchange))).toMatchObject({ code: PassportErrorCode.RefreshInvalid })
    })

    it("signs out: the session ends, the cookie is cleared and the token no longer refreshes", async () => {
        const { database, subject } = await boot()
        const login = exchangeOf({ email: "a@example.test", password: "correct horse" })
        await subject.login(login.exchange)
        const cookie = login.written.get(COOKIE) ?? ""

        const out = exchangeOf({}, cookie)
        await subject.logout(out.exchange)

        expect(out.written.get(COOKIE)).toBe("")
        expect(database.rows(IdentitySessionEntity)).toHaveLength(0)
        expect(await rejection(subject.refresh(exchangeOf({}, cookie).exchange))).toMatchObject({ code: PassportErrorCode.RefreshInvalid })
    })

    it("refuses a wrong password with the passport error family and locks the address after its failures", async () => {
        const { subject } = await boot()
        const attempt = (password: string) => rejection(subject.login(exchangeOf({ email: "a@example.test", password }).exchange))

        expect(await attempt("wrong")).toMatchObject({ code: PassportErrorCode.InvalidCredentials })
        expect(await attempt("wrong")).toMatchObject({ code: PassportErrorCode.InvalidCredentials })
        expect(await attempt("wrong")).toMatchObject({ code: PassportErrorCode.InvalidCredentials })
        expect(await attempt("correct horse")).toMatchObject({ code: PassportErrorCode.TooManyAttempts })
    })

    it("serves the public keys and reports the Google door as unavailable", async () => {
        const { subject } = await boot()

        expect((await subject.jwks()).keys).toHaveLength(1)
        expect(await rejection(subject.beginGoogle(exchangeOf({}).exchange))).toMatchObject({ code: PassportErrorCode.GoogleUnavailable })
        expect(await subject.completeGoogle(exchangeOf({}).exchange)).toEqual({ url: "https://app.spec.test/sign-in?auth=error", statusCode: 303 })
        expect(await rejection(subject.refresh(exchangeOf({}).exchange))).toBeInstanceOf(PassportError)
    })

    it("rethrows a failure that is not a sign-in refusal as it is", async () => {
        const doors = { login: () => Promise.reject(new Error("boom")) }
        const moduleRef = await Test.createTestingModule({
            providers: [IdentitySignInService, { provide: PASSPORT_DOORS, useValue: doors }, { provide: PASSPORT_SESSIONS, useValue: {} }],
        }).compile()

        await expect(moduleRef.get(IdentitySignInService).login(exchangeOf({}).exchange)).rejects.toThrow("boom")
    })
})
