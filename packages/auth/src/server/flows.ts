import passport from "passport"
import { isPlainRecord } from "@starci/common"
import { AUTH_ERROR_CODES } from "../contracts/index.ts"
import type { AuthErrorCode } from "../contracts/index.ts"
import { AuthError } from "./errors.ts"
import type { HttpExchange } from "./http.ts"
import type { AuthOptions } from "./options.ts"
import type { AuthSubject } from "./ports.ts"
import { sameSitePath } from "./primitives.ts"
import { GOOGLE_CODES, GOOGLE_PROVIDER_ID } from "./providers/google.ts"
import type { AnySignInProvider } from "./providers/provider.ts"
import { PROVIDER_CODES } from "./providers/provider.ts"
import { providersOf } from "./providers/registry.ts"

/** The result of a provider's callback leg. */
export interface ProviderCompletion {
    /** The signed-in person. */
    readonly subject: AuthSubject
    /** The same-site path the browser lands on. */
    readonly next: string
}

/** The result of the Google callback leg (the name 0.5.0 gave it). */
export type GoogleCompletion = ProviderCompletion

const isSubject = (value: unknown): value is AuthSubject =>
    isPlainRecord(value) && typeof value.userId === "string" && typeof value.email === "string"

type Settled = (error: unknown, user?: unknown, info?: unknown) => void
type StrategyHandler = (req: HttpExchange["req"], res: HttpExchange["res"], next: (error?: unknown) => void) => void

const isHandler = (value: unknown): value is StrategyHandler => typeof value === "function"

/** The middleware passport built; passport types it as any, so it is checked once here. */
const handlerOf = (built: unknown, code: AuthErrorCode): StrategyHandler => {
    if (!isHandler(built)) throw new AuthError(code)
    return built
}

const errorOf = (error: unknown): Error => (error instanceof Error ? error : new Error("passport"))

/** The code a door refuses an unregistered provider with: Google's own (as in 0.5.0), else the provider-neutral one. */
const unavailableOf = (id: string): AuthError =>
    new AuthError(id === GOOGLE_PROVIDER_ID ? GOOGLE_CODES.unavailable : PROVIDER_CODES.unavailable, { context: { provider: id } })

/** Runs the passport strategies for one request without sessions; the only caller of `passport.authenticate`. */
export class AuthFlows {
    readonly #providers: ReadonlyMap<string, AnySignInProvider>

    constructor(options: Pick<AuthOptions, "google" | "providers">) {
        this.#providers = new Map(providersOf(options).map((provider) => [provider.id, provider]))
    }

    /** The ids of the registered providers, in registration order. */
    get providers(): readonly string[] {
        return [...this.#providers.keys()]
    }

    /** Runs the local strategy over the posted body; answers the person, or throws the app's refusal. */
    authenticateLocal(exchange: HttpExchange): Promise<AuthSubject> {
        return new Promise<AuthSubject>((resolve, reject) => {
            const settled: Settled = (error, user) => {
                if (error !== null && error !== undefined) reject(errorOf(error))
                else if (isSubject(user)) resolve(user)
                else reject(new AuthError(AUTH_ERROR_CODES.MissingCredentials))
            }
            handlerOf(passport.authenticate("local", { session: false }, settled), AUTH_ERROR_CODES.MissingCredentials)(exchange.req, exchange.res, reject)
        })
    }

    /** Sends the browser to the provider's consent screen (the response is the redirect); the optional `next` query value is kept in the state cookie. */
    begin(id: string, exchange: HttpExchange): Promise<void> {
        const provider = this.#providers.get(id)
        if (provider === undefined) return Promise.reject(unavailableOf(id))
        return new Promise<void>((resolve, reject) => {
            exchange.res.once("finish", resolve)
            const built: unknown = passport.authenticate(provider.id, { session: false, ...provider.authorizeParams }, (error: unknown) => {
                reject(errorOf(error))
            })
            handlerOf(built, provider.codes.unavailable)(exchange.req, exchange.res, reject)
        })
    }

    /** Finishes the provider's round trip: the state cookie, the PKCE verifier and the profile must all check out. */
    complete(id: string, exchange: HttpExchange): Promise<ProviderCompletion> {
        const provider = this.#providers.get(id)
        if (provider === undefined) return Promise.reject(unavailableOf(id))
        return new Promise<ProviderCompletion>((resolve, reject) => {
            const settled: Settled = (error, user, info) => {
                if (error !== null && error !== undefined) {
                    reject(errorOf(error))
                    return
                }
                if (!isSubject(user)) {
                    reject(new AuthError(provider.codes.stateInvalid, { context: { provider: provider.id } }))
                    return
                }
                const state = isPlainRecord(info) && isPlainRecord(info.state) ? info.state.next : undefined
                resolve({ subject: user, next: sameSitePath(state, "/") })
            }
            handlerOf(passport.authenticate(provider.id, { session: false }, settled), provider.codes.unavailable)(exchange.req, exchange.res, reject)
        })
    }

    /** Sends the browser to the Google consent screen. */
    beginGoogle(exchange: HttpExchange): Promise<void> {
        return this.begin(GOOGLE_PROVIDER_ID, exchange)
    }

    /** Finishes the Google round trip. */
    completeGoogle(exchange: HttpExchange): Promise<GoogleCompletion> {
        return this.complete(GOOGLE_PROVIDER_ID, exchange)
    }
}
