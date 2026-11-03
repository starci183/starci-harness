import "reflect-metadata"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { describe, it } from "node:test"
import { Module } from "@nestjs/common"
import type { DynamicModule } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import { AUTH_ERROR_CODES } from "../contracts/index.ts"
import { testAuthOptions } from "../testing/index.ts"
import { AuthModule } from "./auth.module.ts"
import {
    AUTH_DOORS_SERVICE,
    AUTH_GOOGLE_STRATEGY,
    AUTH_LOCAL_STRATEGY,
    AUTH_PASSWORDS,
    AUTH_PRINCIPAL_VERIFIER,
    AUTH_SIGN_IN_BUDGET,
} from "./auth.tokens.ts"
import type { AuthDoors } from "./doors.ts"
import { AuthError } from "./errors.ts"
import type { CookieWrite, HttpExchange } from "./http.ts"
import type { AuthAuthenticator, AuthSubject, GoogleProfile } from "./ports.ts"
import type { AuthPasswords } from "./passwords.ts"
import { normalizeEmail } from "./primitives.ts"
import type { SignInBudget } from "./budget.ts"
import type { AuthPrincipalVerifier } from "./verifier.ts"

const must = <T>(value: T | undefined): T => {
    assert.ok(value !== undefined)
    return value
}

const APP_AUTHENTICATOR = Symbol("app.authenticator")

/** The app's sign-in decisions, as `domain/identity` writes them over the module's passwords and budget. */
class Directory {
    readonly hashes = new Map<string, { id: string; hash: string }>()
    readonly googleProfiles: GoogleProfile[] = []
}

const globalAppModule = (directory: Directory): DynamicModule => {
    class AppIdentityModule {
        readonly kind = "app-identity"
    }
    Module({})(AppIdentityModule)
    return {
        module: AppIdentityModule,
        global: true,
        providers: [
            {
                provide: APP_AUTHENTICATOR,
                inject: [AUTH_PASSWORDS, AUTH_SIGN_IN_BUDGET],
                useFactory: (passwords: AuthPasswords, budget: SignInBudget): AuthAuthenticator => ({
                    verifyPassword: (email, password) =>
                        budget.counted("login", normalizeEmail(email), async () => {
                            const row = directory.hashes.get(normalizeEmail(email))
                            const matches = await passwords.verify(password, row?.hash ?? "")
                            if (row === undefined || !matches) throw new AuthError(AUTH_ERROR_CODES.InvalidCredentials)
                            return { passed: true, value: { userId: row.id, email: normalizeEmail(email) } satisfies AuthSubject }
                        }),
                    signInWithGoogle: (profile) => {
                        directory.googleProfiles.push(profile)
                        return Promise.resolve({ userId: "google-user", email: profile.email ?? "" })
                    },
                }),
            },
        ],
        exports: [APP_AUTHENTICATOR],
    }
}

class FakeResponse extends EventEmitter {
    statusCode = 200
    readonly headers = new Map<string, string>()
    readonly cookies: { name: string; value: string; options: CookieWrite }[] = []
    readonly cleared: string[] = []
    cookie(name: string, value: string, options: CookieWrite): void {
        this.cookies.push({ name, value, options })
    }
    clearCookie(name: string): void {
        this.cleared.push(name)
    }
    setHeader(name: string, value: string): void {
        this.headers.set(name.toLowerCase(), value)
    }
    end(): void {
        this.emit("finish")
    }
}

const exchange = (init: { body?: object; query?: object; cookie?: string }): { exchange: HttpExchange; res: FakeResponse } => {
    const res = new FakeResponse()
    const req = {
        headers: { ...(init.cookie === undefined ? {} : { cookie: init.cookie }), "user-agent": "spec" },
        body: init.body ?? {},
        query: init.query ?? {},
        ip: "203.0.113.5",
        res,
        method: "GET",
        url: "/auth/google",
        originalUrl: "/auth/google",
        protocol: "https",
        get: () => "api.example.test",
    }
    return { exchange: { req, res } as unknown as HttpExchange, res }
}

const boot = async (withGoogle: boolean) => {
    const directory = new Directory()
    const options = testAuthOptions({
        google: withGoogle
            ? { clientId: "client-id", clientSecret: { reveal: () => "client-secret" }, callbackUrl: "https://api.example.test/auth/google/callback" }
            : null,
    })
    const moduleRef = await Test.createTestingModule({
        imports: [globalAppModule(directory), AuthModule.register({ ...options, isGlobal: true, authenticator: APP_AUTHENTICATOR })],
    }).compile()
    await moduleRef.init()
    return { moduleRef, directory, options, doors: moduleRef.get<AuthDoors>(AUTH_DOORS_SERVICE) }
}

describe("AuthModule wiring and the passport flows", () => {
    it("signs in with the local strategy, rotates on refresh and signs out, with a principal the verifier accepts", async () => {
        const { moduleRef, directory, options, doors } = await boot(false)
        directory.hashes.set("a@example.test", { id: "user-1", hash: await moduleRef.get<AuthPasswords>(AUTH_PASSWORDS).hash("correct horse") })
        options.accounts.set({ id: "user-1", email: "a@example.test", disabled: false })

        const login = exchange({ body: { email: " A@Example.test ", password: "correct horse" } })
        const grant = await doors.login(login.exchange)
        assert.equal(grant.user.email, "a@example.test")
        assert.equal(grant.expiresIn, 900)
        const verifier = moduleRef.get<AuthPrincipalVerifier>(AUTH_PRINCIPAL_VERIFIER)
        const principal = await verifier.verify(grant.accessToken)
        assert.equal(principal.kind === "ok" && principal.value.id, "user-1")
        const cookie = must(login.res.cookies.find((entry) => entry.name === "auth_refresh"))
        assert.equal(cookie.options.httpOnly, true)

        const refreshed = exchange({ cookie: `auth_refresh=${cookie.value}` })
        await doors.refresh(refreshed.exchange)
        const rotated = must(refreshed.res.cookies[0])
        assert.notEqual(rotated.value, cookie.value, "refresh rotated the cookie")

        const out = exchange({ cookie: `auth_refresh=${rotated.value}` })
        await doors.logout(out.exchange)
        assert.deepEqual(out.res.cleared, ["auth_refresh", "auth_refresh"])
        const again = exchange({ cookie: `auth_refresh=${rotated.value}` })
        await assert.rejects(doors.refresh(again.exchange), (error: unknown) => error instanceof AuthError && error.code === AUTH_ERROR_CODES.RefreshInvalid)
        assert.deepEqual(again.res.cleared, ["auth_refresh", "auth_refresh"], "a refresh that fails clears the cookie")
        await moduleRef.close()
    })

    it("refuses a wrong password and counts only failures", async () => {
        const { moduleRef, directory, doors } = await boot(false)
        directory.hashes.set("a@example.test", { id: "user-1", hash: await moduleRef.get<AuthPasswords>(AUTH_PASSWORDS).hash("right-password") })
        const attempt = (password: string) => doors.login(exchange({ body: { email: "a@example.test", password } }).exchange)
        await assert.rejects(attempt("wrong"), (error: unknown) => error instanceof AuthError && error.code === AUTH_ERROR_CODES.InvalidCredentials)
        await assert.rejects(attempt("wrong"), AuthError)
        await attempt("right-password")
        await assert.rejects(attempt("wrong"), (error: unknown) => error instanceof AuthError && error.code === AUTH_ERROR_CODES.InvalidCredentials)
        await moduleRef.close()
    })

    it("refuses a login without credentials", async () => {
        const { moduleRef, doors } = await boot(false)
        await assert.rejects(doors.login(exchange({}).exchange), (error: unknown) => error instanceof AuthError && error.code === AUTH_ERROR_CODES.MissingCredentials)
        await moduleRef.close()
    })

    it("answers the Google door as unavailable when the deployment has no client", async () => {
        const { moduleRef, doors } = await boot(false)
        assert.equal(moduleRef.get(AUTH_GOOGLE_STRATEGY), null)
        assert.ok(moduleRef.get(AUTH_LOCAL_STRATEGY))
        await assert.rejects(doors.beginGoogle(exchange({}).exchange), (error: unknown) => error instanceof AuthError && error.code === AUTH_ERROR_CODES.GoogleUnavailable)
        const redirect = await doors.completeGoogle(exchange({}).exchange)
        assert.deepEqual(redirect, { url: "https://app.example.test/sign-in?auth=error", statusCode: 303 })
        await moduleRef.close()
    })

    it("runs Google with state and PKCE: the consent redirect carries the S256 challenge, the callback needs the cookie, the state and returns the verifier to the token exchange", async () => {
        const { moduleRef, directory, options, doors } = await boot(true)
        options.accounts.set({ id: "google-user", email: "g@example.test", disabled: false })

        const begin = exchange({ query: { next: "/inbox" } })
        await doors.beginGoogle(begin.exchange)
        const location = new URL(begin.res.headers.get("location") ?? "")
        assert.equal(location.origin + location.pathname, "https://accounts.google.com/o/oauth2/v2/auth")
        assert.equal(location.searchParams.get("code_challenge_method"), "S256")
        assert.ok(location.searchParams.get("code_challenge"))
        assert.equal(location.searchParams.get("client_id"), "client-id")
        const handle = location.searchParams.get("state") ?? ""
        assert.ok(handle)
        const stateCookie = must(begin.res.cookies.find((entry) => entry.name === "auth_google_state"))
        assert.equal(stateCookie.options.path, "/auth/google")

        const strategy = moduleRef.get<Record<string, unknown>>(AUTH_GOOGLE_STRATEGY)
        const exchanged: Record<string, unknown>[] = []
        Object.assign(strategy._oauth2 as object, {
            getOAuthAccessToken: (_code: string, params: Record<string, unknown>, done: (error: unknown, access: string, refresh: string, results: object) => void) => {
                exchanged.push(params)
                done(null, "access", "refresh", {})
            },
        })
        Object.assign(strategy, {
            userProfile: (_token: string, done: (error: unknown, profile: object) => void) => { done(null, { id: "g-1", displayName: "G", emails: [{ value: "g@example.test" }], photos: [], _json: { email_verified: true } }); },
        })

        const wrongState = await doors.completeGoogle(exchange({ query: { code: "c", state: "forged" }, cookie: `auth_google_state=${stateCookie.value}` }).exchange)
        assert.equal(wrongState.url, "https://app.example.test/sign-in?auth=error")
        const noCookie = await doors.completeGoogle(exchange({ query: { code: "c", state: handle } }).exchange)
        assert.equal(noCookie.url, "https://app.example.test/sign-in?auth=error")
        assert.equal(exchanged.length, 0, "no code is exchanged for a round trip we cannot prove")

        const callback = exchange({ query: { code: "c", state: handle }, cookie: `auth_google_state=${stateCookie.value}` })
        const redirect = await doors.completeGoogle(callback.exchange)
        assert.deepEqual(redirect, { url: "https://app.example.test/inbox", statusCode: 303 })
        assert.equal(typeof must(exchanged[0]).code_verifier, "string")
        assert.equal(must(directory.googleProfiles[0]).subject, "g-1")
        assert.equal(must(directory.googleProfiles[0]).emailVerified, true)
        assert.ok(callback.res.cookies.some((entry) => entry.name === "auth_refresh"))
        await moduleRef.close()
    })

    it("serves the public keys of the signer", async () => {
        const { moduleRef } = await boot(false)
        const sessions = moduleRef.get<{ jwks(): Promise<{ keys: unknown[] }> }>(Symbol.for("@starci/auth/sessions"))
        assert.equal((await sessions.jwks()).keys.length, 1)
        await moduleRef.close()
    })

    it("registers asynchronously", async () => {
        const directory = new Directory()
        const options = testAuthOptions()
        const moduleRef = await Test.createTestingModule({
            imports: [globalAppModule(directory), AuthModule.registerAsync({ isGlobal: true, authenticator: APP_AUTHENTICATOR, useFactory: () => options })],
        }).compile()
        assert.ok(moduleRef.get(AUTH_DOORS_SERVICE))
        await moduleRef.close()
    })
})
