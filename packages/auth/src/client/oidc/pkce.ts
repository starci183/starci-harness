/** base64url of bytes, without padding. */
export const bytesToBase64Url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")

/** 256 unpredictable bits as base64url: a state, a nonce or a PKCE verifier (43 characters, inside the 43 to 128 RFC 7636 asks). */
export const randomText = (): string => bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)))

/** The S256 challenge of a PKCE verifier: base64url(SHA-256(verifier)). */
export const challengeOf = async (verifier: string): Promise<string> =>
    bytesToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))))

/** Non-empty text, else undefined. */
export const textOf = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined)

/**
 * The claims of a token read WITHOUT checking its signature. For display only (who is signed in): the front end trusts no claim for a
 * decision, the back end verifies every token it is sent.
 */
export const claimsOf = (token: string): Readonly<Record<string, unknown>> => {
    const payload = token.split(".")[1]
    if (payload === undefined) return {}
    try {
        const text = new TextDecoder().decode(Uint8Array.from(atob(payload.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0)))
        const parsed: unknown = JSON.parse(text)
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? Object.fromEntries(Object.entries(parsed)) : {}
    } catch {
        return {}
    }
}

const SAME_SITE_PATH = /^\/(?![/\\])/u
const LINE_BREAK = /[\r\n]/u

/** A same-site path (one leading slash, no line break), else the fallback path: a return address never leaves the site. */
export const sameSitePath = (value: unknown, fallback: string): string =>
    typeof value === "string" && SAME_SITE_PATH.test(value) && !LINE_BREAK.test(value) ? value : fallback
