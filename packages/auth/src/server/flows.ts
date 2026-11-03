import passport from "passport"
import { AUTH_ERROR_CODES } from "../contracts/index.ts"
import { AuthError } from "./errors.ts"
import type { HttpExchange } from "./http.ts"
import type { AuthOptions } from "./options.ts"
import type { AuthSubject } from "./ports.ts"
import { isRecord, sameSitePath } from "./primitives.ts"

/** The result of the Google callback leg. */
export interface GoogleCompletion {
    /** The signed-in person. */
    readonly subject: AuthSubject
    /** The same-site path the browser lands on. */
    readonly next: string
}

const isSubject = (value: unknown): value is AuthSubject =>
    isRecord(value) && typeof value.userId === "string" && typeof value.email === "string"

type Settled = (error: unknown, user?: unknown, info?: unknown) => void
type StrategyHandler = (req: HttpExchange["req"], res: HttpExchange["res"], next: (error?: unknown) => void) => void

const isHandler = (value: unknown): value is StrategyHandler => typeof value === "function"

/** The middleware passport built; passport types it as any, so it is checked once here. */
const handlerOf = (built: unknown): StrategyHandler => {
    if (!isHandler(built)) throw new AuthError(AUTH_ERROR_CODES.GoogleUnavailable)
    return built
}

const errorOf = (error: unknown): Error => (error instanceof Error ? error : new Error("passport"))

/** Runs the passport strategies for one request without sessions; the only caller of `passport.authenticate`. */
export class AuthFlows {
    readonly #google: AuthOptions["google"]

    constructor(options: Pick<AuthOptions, "google">) {
        this.#google = options.google
    }

    /** Runs the local strategy over the posted body; answers the person, or throws the app's refusal. */
    authenticateLocal(exchange: HttpExchange): Promise<AuthSubject> {
        return new Promise<AuthSubject>((resolve, reject) => {
            const settled: Settled = (error, user) => {
                if (error !== null && error !== undefined) reject(errorOf(error))
                else if (isSubject(user)) resolve(user)
                else reject(new AuthError(AUTH_ERROR_CODES.MissingCredentials))
            }
            handlerOf(passport.authenticate("local", { session: false }, settled))(exchange.req, exchange.res, reject)
        })
    }

    /** Sends the browser to the Google consent screen (the response is the redirect); the optional `next` query value is kept in the state cookie. */
    beginGoogle(exchange: HttpExchange): Promise<void> {
        if (this.#google === null) return Promise.reject(new AuthError(AUTH_ERROR_CODES.GoogleUnavailable))
        return new Promise<void>((resolve, reject) => {
            exchange.res.once("finish", resolve)
            const built: unknown = passport.authenticate("google", { session: false, prompt: "select_account" }, (error: unknown) => {
                reject(errorOf(error))
            })
            handlerOf(built)(exchange.req, exchange.res, reject)
        })
    }

    /** Finishes the Google round trip: the state cookie, the PKCE verifier and the profile must all check out. */
    completeGoogle(exchange: HttpExchange): Promise<GoogleCompletion> {
        if (this.#google === null) return Promise.reject(new AuthError(AUTH_ERROR_CODES.GoogleUnavailable))
        return new Promise<GoogleCompletion>((resolve, reject) => {
            const settled: Settled = (error, user, info) => {
                if (error !== null && error !== undefined) {
                    reject(errorOf(error))
                    return
                }
                if (!isSubject(user)) {
                    reject(new AuthError(AUTH_ERROR_CODES.GoogleStateInvalid))
                    return
                }
                const state = isRecord(info) && isRecord(info.state) ? info.state.next : undefined
                resolve({ subject: user, next: sameSitePath(state, "/") })
            }
            handlerOf(passport.authenticate("google", { session: false }, settled))(exchange.req, exchange.res, reject)
        })
    }
}
