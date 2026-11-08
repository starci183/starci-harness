import "reflect-metadata"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { describe, it } from "node:test"
import { Module } from "@nestjs/common"
import type { DynamicModule } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import type { Strategy } from "passport"
import { AUTH_ERROR_CODES, providerCallbackDoor, providerDoor } from "../../contracts/index.ts"
import { testAuthOptions } from "../../testing/index.ts"
import { AuthModule } from "../auth.module.ts"
import { AUTH_DOORS_SERVICE, AUTH_GOOGLE_STRATEGY, AUTH_PROVIDERS } from "../auth.tokens.ts"
import type { AuthDoors } from "../doors.ts"
import { AuthError } from "../errors.ts"
import { AuthFlows } from "../flows.ts"
import type { CookieWrite, HttpExchange, HttpRequest } from "../http.ts"
import type { AuthAuthenticator, AuthSubject, ProviderProfile } from "../ports.ts"
import { GITHUB_PROVIDER_ID, github } from "./github.ts"
import { GOOGLE_CODES, google } from "./google.ts"
import { PROVIDER_CODES, defineProvider, signInWithProvider } from "./provider.ts"
import type { ProviderContext } from "./provider.ts"
import { providersOf } from "./registry.ts"
import type { ProviderEntry } from "./registry.ts"

const must = <T>(value: T | undefined): T => {
    assert.ok(value !== undefined)
    return value
}

const GOOGLE = { clientId: "google-client", clientSecret: "google-secret", callbackUrl: "https://api.example.test/auth/google/callback" }
const GITHUB = { clientId: "github-client", clientSecret: { reveal: () => "github-secret" }, callbackUrl: "https://api.example.test/auth/github/callback" }

/**
 * A third provider in one definition, the way a next one (Facebook) is added: an id, its options, its profile mapping and a passport
 * strategy that keeps its round trip in the state store the module hands it. Nothing else in the package changes for it.
 */
const stub = (options: { readonly authorizeUrl: string }) =>
    defineProvider({
        id: "stub",
        options,
        profileOf: (raw: { readonly id: string; readonly mail: string }): ProviderProfile => ({ provider: "stub", subject: raw.id, email: raw.mail, emailVerified: true, name: null, picture: null }),
        strategy: (context: ProviderContext): Strategy => ({
            name: "stub",
            authenticate(req) {
                const request = req as unknown as HttpRequest & { readonly query: Readonly<Record<string, unknown>> }
                const code = request.query.code
                if (typeof code !== "string") {
                    context.state.store(request, "stub-verifier", undefined, undefined, (_error, handle) => {
                        this.redirect(`${options.authorizeUrl}?state=${handle ?? ""}`)
                    })
                    return
                }
                context.state.verify(request, String(request.query.state), undefined, (_error, verifier, state) => {
                    if (verifier !== "stub-verifier") {
                        this.fail()
                        return
                    }
                    signInWithProvider(context.authenticator, { provider: "stub", subject: code, email: `${code}@stub.test`, emailVerified: true, name: null, picture: null }).then(
                        (subject) => {
                            this.success(subject, { state })
                        },
                        (error: unknown) => {
                            this.error(error instanceof Error ? error : new Error(String(error)))
                        },
                    )
                })
            },
        }),
    })

class FakeResponse extends EventEmitter {
    statusCode = 200
    readonly headers = new Map<string, string>()
    readonly cookies: { name: string; value: string; options: CookieWrite }[] = []
    cookie(name: string, value: string, options: CookieWrite): void {
        this.cookies.push({ name, value, options })
    }
    clearCookie(): void {
        return undefined
    }
    setHeader(name: string, value: string): void {
        this.headers.set(name.toLowerCase(), value)
    }
    end(): void {
        this.emit("finish")
    }
}

const exchange = (init: { query?: object; cookie?: string } = {}): { exchange: HttpExchange; res: FakeResponse } => {
    const res = new FakeResponse()
    const req = {
        headers: { ...(init.cookie === undefined ? {} : { cookie: init.cookie }), "user-agent": "spec" },
        body: {},
        query: init.query ?? {},
        ip: "203.0.113.5",
        res,
        method: "GET",
        url: "/auth",
        originalUrl: "/auth",
        protocol: "https",
        get: () => "api.example.test",
    }
    return { exchange: { req, res } as unknown as HttpExchange, res }
}

const APP_AUTHENTICATOR = Symbol("app.authenticator")

const boot = async (providers: Parameters<typeof testAuthOptions>[0], withProvider = true) => {
    const logged: unknown[] = []
    const seen: ProviderProfile[] = []
    const authenticator: AuthAuthenticator = {
        verifyPassword: () => Promise.reject(new AuthError(AUTH_ERROR_CODES.InvalidCredentials)),
        signInWithGoogle: (profile) => Promise.resolve({ userId: `google-${profile.subject}`, email: profile.email ?? "" }),
        ...(withProvider
            ? {
                  signInWithProvider: (profile: ProviderProfile): Promise<AuthSubject> => {
                      seen.push(profile)
                      return Promise.resolve({ userId: `${profile.provider}-${profile.subject}`, email: profile.email ?? "" })
                  },
              }
            : {}),
    }
    class AppIdentityModule {
        readonly kind = "app-identity"
    }
    Module({})(AppIdentityModule)
    const app: DynamicModule = { module: AppIdentityModule, global: true, providers: [{ provide: APP_AUTHENTICATOR, useValue: authenticator }], exports: [APP_AUTHENTICATOR] }
    const options = testAuthOptions({ logger: { warn: (event, context) => logged.push([event, context]) }, ...providers })
    const moduleRef = await Test.createTestingModule({ imports: [app, AuthModule.register({ ...options, isGlobal: true, authenticator: APP_AUTHENTICATOR })] }).compile()
    await moduleRef.init()
    options.accounts.set({ id: "github-4242", email: "primary@example.test", disabled: false })
    options.accounts.set({ id: "stub-c-1", email: "c-1@stub.test", disabled: false })
    return { moduleRef, seen, logged, doors: moduleRef.get<AuthDoors>(AUTH_DOORS_SERVICE) }
}

describe("sign-in providers: the registry", () => {
    it("lists Google from the 0.5.0 option first, then the providers in order, each with its door, its state cookie and its codes", () => {
        const listed = providersOf({ google: GOOGLE, providers: [github(GITHUB), stub({ authorizeUrl: "https://stub.test/authorize" })] })
        assert.deepEqual(listed.map((provider) => provider.id), ["google", "github", "stub"])
        assert.deepEqual(listed.map((provider) => [provider.stateCookie, provider.statePath]), [
            ["auth_google_state", "/auth/google"],
            ["auth_github_state", "/auth/github"],
            ["auth_stub_state", "/auth/stub"],
        ])
        assert.deepEqual(listed.map((provider) => provider.codes), [GOOGLE_CODES, PROVIDER_CODES, PROVIDER_CODES])
        assert.deepEqual(must(listed[0]).authorizeParams, { prompt: "select_account" })
        assert.deepEqual(providersOf({ google: null }), [])
        assert.deepEqual(providersOf({}), [])
        assert.equal(providerDoor("github"), "/auth/github")
        assert.equal(providerCallbackDoor("github"), "/auth/github/callback")
    })

    it("refuses Google named both ways, two providers with one id and an id that cannot be a door path", () => {
        const invalid = (error: unknown) => error instanceof AuthError && error.code === AUTH_ERROR_CODES.ProvidersInvalid
        assert.throws(() => providersOf({ google: GOOGLE, providers: [google(GOOGLE)] }), invalid)
        assert.throws(() => providersOf({ providers: [github(GITHUB), github(GITHUB)] }), invalid)
        for (const id of ["GitHub", "a/b", "", "-x", "x".repeat(40)]) assert.throws(() => defineProvider({ id, options: {}, profileOf: () => ({ provider: id, subject: "s", email: null, emailVerified: false, name: null, picture: null }), strategy: () => ({ authenticate: () => undefined }) }), invalid, id)
        assert.equal(google({ ...GOOGLE, stateCookie: "g_state" }).stateCookie, "g_state")
        assert.equal(github({ ...GITHUB, stateCookie: "gh_state" }).stateCookie, "gh_state")
    })

    it("maps each provider's answer to one profile shape", () => {
        const profile = must(providersOf({ providers: [stub({ authorizeUrl: "x" })] })[0]).profileOf as (raw: { id: string; mail: string }) => ProviderProfile
        assert.deepEqual(profile({ id: "7", mail: "m@stub.test" }), { provider: "stub", subject: "7", email: "m@stub.test", emailVerified: true, name: null, picture: null })
        const googleProfile = google(GOOGLE).profileOf({ id: "g-1", displayName: "", emails: [], photos: [], _json: { email_verified: "true" } } as never)
        assert.deepEqual(googleProfile, { provider: "google", subject: "g-1", email: null, emailVerified: true, name: null, picture: null })
    })

    it("refuses another provider's sign-in when the app's authenticator has no signInWithProvider", async () => {
        const authenticator: AuthAuthenticator = { verifyPassword: () => Promise.reject(new Error("x")), signInWithGoogle: () => Promise.reject(new Error("x")) }
        await assert.rejects(
            signInWithProvider(authenticator, { provider: "github", subject: "1", email: null, emailVerified: false, name: null, picture: null }),
            (error: unknown) => error instanceof AuthError && error.code === AUTH_ERROR_CODES.ProviderUnavailable,
        )
    })

    it("answers an unregistered provider with its unavailable code: Google's own, and the neutral one for any other", async () => {
        const flows = new AuthFlows({ providers: [github(GITHUB)] })
        assert.deepEqual(flows.providers, ["github"])
        await assert.rejects(flows.beginGoogle(exchange().exchange), (error: unknown) => error instanceof AuthError && error.code === AUTH_ERROR_CODES.GoogleUnavailable)
        await assert.rejects(flows.begin("facebook", exchange().exchange), (error: unknown) => error instanceof AuthError && error.code === AUTH_ERROR_CODES.ProviderUnavailable)
        await assert.rejects(flows.complete("facebook", exchange().exchange), (error: unknown) => error instanceof AuthError && error.code === AUTH_ERROR_CODES.ProviderUnavailable)
    })
})

describe("sign-in providers: the module runs each one", () => {
    it("builds a strategy and a state store per provider, registered under its id, and keeps AUTH_GOOGLE_STRATEGY", async () => {
        const { moduleRef } = await boot({ google: GOOGLE, providers: [github(GITHUB), stub({ authorizeUrl: "https://stub.test/authorize" })] })
        const entries = moduleRef.get<ReadonlyMap<string, ProviderEntry>>(AUTH_PROVIDERS)
        assert.deepEqual([...entries.keys()], ["google", "github", "stub"])
        assert.equal(moduleRef.get(AUTH_GOOGLE_STRATEGY), must(entries.get("google")).strategy)
        assert.deepEqual([...entries.values()].map((entry) => [entry.state.provider, entry.state.cookieName]), [
            ["google", "auth_google_state"],
            ["github", "auth_github_state"],
            ["stub", "auth_stub_state"],
        ])
        await moduleRef.close()
        const without = await boot({ providers: [github(GITHUB)] })
        assert.equal(without.moduleRef.get(AUTH_GOOGLE_STRATEGY), null)
        await without.moduleRef.close()
    })

    it("runs the stub provider's round trip end to end through the doors: one definition is the whole extension", async () => {
        const { moduleRef, seen, doors } = await boot({ providers: [stub({ authorizeUrl: "https://stub.test/authorize" })] })
        const begin = exchange({ query: { next: "/settings" } })
        await doors.beginProvider("stub", begin.exchange)
        const location = new URL(begin.res.headers.get("location") ?? "")
        assert.equal(location.origin + location.pathname, "https://stub.test/authorize")
        const handle = location.searchParams.get("state") ?? ""
        const cookie = must(begin.res.cookies.find((entry) => entry.name === "auth_stub_state"))
        assert.equal(cookie.options.path, "/auth/stub")
        const back = exchange({ query: { code: "c-1", state: handle }, cookie: `auth_stub_state=${cookie.value}` })
        assert.deepEqual(await doors.completeProvider("stub", back.exchange), { url: "https://app.example.test/settings", statusCode: 303 })
        assert.equal(must(seen[0]).subject, "c-1")
        assert.ok(back.res.cookies.some((entry) => entry.name === "auth_refresh"))
        const forged = await doors.completeProvider("stub", exchange({ query: { code: "c-1", state: "forged" }, cookie: `auth_stub_state=${cookie.value}` }).exchange)
        assert.equal(forged.url, "https://app.example.test/sign-in?auth=error")
        await moduleRef.close()
    })

    it("runs GitHub with state and PKCE: the consent redirect carries the S256 challenge, the callback reads the account and its verified address", async () => {
        const { moduleRef, seen, logged, doors } = await boot({ providers: [github(GITHUB)] })
        const begin = exchange({ query: { returnTo: "https://app.example.test/repos?tab=2" } })
        await doors.beginProvider(GITHUB_PROVIDER_ID, begin.exchange)
        const location = new URL(begin.res.headers.get("location") ?? "")
        assert.equal(location.origin + location.pathname, "https://github.com/login/oauth/authorize")
        assert.equal(location.searchParams.get("code_challenge_method"), "S256")
        assert.ok(location.searchParams.get("code_challenge"))
        assert.equal(location.searchParams.get("client_id"), "github-client")
        assert.equal(location.searchParams.get("scope"), "read:user user:email")
        const handle = location.searchParams.get("state") ?? ""
        const cookie = must(begin.res.cookies.find((entry) => entry.name === "auth_github_state"))
        assert.equal(cookie.options.path, "/auth/github")

        const strategy = must(moduleRef.get<ReadonlyMap<string, ProviderEntry>>(AUTH_PROVIDERS).get(GITHUB_PROVIDER_ID)).strategy as unknown as Record<string, unknown>
        const exchanged: Record<string, unknown>[] = []
        const asked: { url: string; token: string }[] = []
        const answers: Record<string, { error: unknown; body?: string }> = {
            "https://api.github.com/user": { error: null, body: JSON.stringify({ id: 4242, login: "octo", name: null, email: "public@example.test", avatar_url: "https://avatars.test/4242" }) },
            "https://api.github.com/user/emails": { error: null, body: JSON.stringify([{ email: "old@example.test", primary: false, verified: true }, { email: "primary@example.test", primary: true, verified: true }]) },
        }
        Object.assign(strategy._oauth2 as object, {
            getOAuthAccessToken: (_code: string, params: Record<string, unknown>, done: (error: unknown, access: string, refresh: string, results: object) => void) => {
                exchanged.push(params)
                done(null, "gh-access", "", {})
            },
            get: (url: string, token: string, done: (error: unknown, body?: string) => void) => {
                asked.push({ url, token })
                const answer = must(answers[url])
                done(answer.error, answer.body)
            },
        })
        const callback = exchange({ query: { code: "c", state: handle }, cookie: `auth_github_state=${cookie.value}` })
        assert.deepEqual(await doors.completeProvider(GITHUB_PROVIDER_ID, callback.exchange), { url: "https://app.example.test/repos?tab=2", statusCode: 303 }, JSON.stringify(logged))
        assert.equal(typeof must(exchanged[0]).code_verifier, "string")
        assert.deepEqual(asked.map((entry) => [entry.url, entry.token]), [["https://api.github.com/user", "gh-access"], ["https://api.github.com/user/emails", "gh-access"]])
        assert.deepEqual(must(seen[0]), { provider: "github", subject: "4242", email: "primary@example.test", emailVerified: true, name: "octo", picture: "https://avatars.test/4242" })

        answers["https://api.github.com/user/emails"] = { error: { statusCode: 403 } }
        const again = exchange({})
        await doors.beginProvider(GITHUB_PROVIDER_ID, again.exchange)
        const second = new URL(again.res.headers.get("location") ?? "").searchParams.get("state") ?? ""
        const secondCookie = must(again.res.cookies.find((entry) => entry.name === "auth_github_state"))
        const refused = await doors.completeProvider(GITHUB_PROVIDER_ID, exchange({ query: { code: "c", state: second }, cookie: `auth_github_state=${secondCookie.value}` }).exchange)
        assert.equal(refused.url, "https://app.example.test/sign-in?auth=error", "a profile GitHub refuses to read ends the round trip")
        await moduleRef.close()
    })

    it("sends a GitHub sign-in back to the sign-in page when the app has no signInWithProvider", async () => {
        const { moduleRef, doors } = await boot({ providers: [github(GITHUB)] }, false)
        const begin = exchange({})
        await doors.beginProvider(GITHUB_PROVIDER_ID, begin.exchange)
        const handle = new URL(begin.res.headers.get("location") ?? "").searchParams.get("state") ?? ""
        const cookie = must(begin.res.cookies.find((entry) => entry.name === "auth_github_state"))
        const strategy = must(moduleRef.get<ReadonlyMap<string, ProviderEntry>>(AUTH_PROVIDERS).get(GITHUB_PROVIDER_ID)).strategy as unknown as Record<string, unknown>
        Object.assign(strategy._oauth2 as object, {
            getOAuthAccessToken: (_code: string, _params: unknown, done: (error: unknown, access: string, refresh: string, results: object) => void) => {
                done(null, "a", "", {})
            },
            get: (_url: string, _token: string, done: (error: unknown, body?: string) => void) => {
                done(null, JSON.stringify({ id: 1, login: "x" }))
            },
        })
        const redirect = await doors.completeProvider(GITHUB_PROVIDER_ID, exchange({ query: { code: "c", state: handle }, cookie: `auth_github_state=${cookie.value}` }).exchange)
        assert.equal(redirect.url, "https://app.example.test/sign-in?auth=error")
        await moduleRef.close()
    })
})
