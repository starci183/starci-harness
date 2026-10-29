import { createHash, randomBytes } from "node:crypto"
import type { CookieOptions, Response } from "express"
import type { RefreshCookieOptions } from "./passport.options"

/** A fresh opaque refresh token (256 bits) and the sha256 the session store keeps instead of it. */
export const newRefreshToken = (): { readonly token: string; readonly hash: string } => {
    const token = randomBytes(32).toString("base64url")
    return { token, hash: refreshTokenHash(token) }
}

/** The sha256 a refresh token is stored and looked up by; the token itself is never stored. */
export const refreshTokenHash = (token: string): string => createHash("sha256").update(token).digest("hex")

const attributes = (options: RefreshCookieOptions): CookieOptions => ({
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: options.path,
})

/** Sets the rotated refresh token: httpOnly, Secure, SameSite=Strict and sent to the refresh door only. */
export const setRefreshCookie = (response: Response, options: RefreshCookieOptions, token: string): void => {
    response.cookie(options.name, token, { ...attributes(options), maxAge: options.ttlSeconds * 1000 })
}

/** Clears the refresh cookie on sign-out or on a detected reuse. */
export const clearRefreshCookie = (response: Response, options: RefreshCookieOptions): void => {
    response.clearCookie(options.name, attributes(options))
}
