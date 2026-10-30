import { randomBytes, timingSafeEqual } from "node:crypto"
import type { Request, Response } from "express"
import { domainAttribute } from "../passport.cookie"

const COOKIE = "oauth_state"
const MAX_AGE_MS = 600_000

type Stored = { readonly state: string; readonly verifier: string }
type StoreCallback = (error: Error | null, state?: string) => void
type VerifyCallback = (error: Error | null, verifier?: string | false, state?: string) => void

/** The response of the request a passport-oauth2 store is called with: passport keeps it on `req.res`. */
const responseOf = (request: Request): Response | undefined => request.res

/** The value of the state cookie in the request's Cookie header (no cookie middleware is installed). */
const cookieOf = (request: Request): string | undefined =>
    request.headers.cookie
        ?.split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${COOKIE}=`))
        ?.slice(COOKIE.length + 1)

const readStored = (request: Request): Stored | undefined => {
    const raw = cookieOf(request)
    if (raw === undefined) return undefined
    const [state, verifier, extra] = raw.split(".")
    return state && verifier && extra === undefined ? { state, verifier } : undefined
}

const sameText = (left: string, right: string): boolean => {
    const a = Buffer.from(left)
    const b = Buffer.from(right)
    return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * The OAuth state and PKCE verifier store of the Google strategy without a server session: both live in one short-lived
 * httpOnly, Secure, SameSite=Lax cookie scoped to the callback path, and the callback must present the same state.
 */
export class CookieStateStore {
    constructor(
        private readonly callbackPath: string,
        private readonly cookieDomain?: string,
    ) {}

    /** Stores a fresh state with the PKCE verifier and hands the state to the authorization redirect. */
    store(request: Request, verifier: string, _state: unknown, _meta: unknown, callback: StoreCallback): void {
        const state = randomBytes(24).toString("base64url")
        responseOf(request)?.cookie(COOKIE, `${state}.${verifier}`, { httpOnly: true, secure: true, sameSite: "lax", path: this.callbackPath, maxAge: MAX_AGE_MS, ...domainAttribute(this.cookieDomain) })
        callback(null, state)
    }

    /** Answers the stored verifier only when the callback's state equals the stored one; the cookie is cleared either way. */
    verify(request: Request, provided: string, callback: VerifyCallback): void {
        const stored = readStored(request)
        responseOf(request)?.clearCookie(COOKIE, { httpOnly: true, secure: true, sameSite: "lax", path: this.callbackPath, ...domainAttribute(this.cookieDomain) })
        if (stored === undefined || !sameText(stored.state, provided)) {
            callback(null, false)
            return
        }
        callback(null, stored.verifier, stored.state)
    }
}
