import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { AUTH_ERROR_CODES } from "../contracts/index.ts"
import { EMAIL_PATTERN, authErrorKey, isLinkInvalid, passwordStrength, strengthKey } from "./shared.ts"
import { failureOfStatus, isSignedOutStatus, isTransientStatus, kindOfStatus } from "./outcome.ts"

describe("client shared logic", () => {
    it("maps wire codes to the friendly sentence keys", () => {
        assert.equal(authErrorKey(AUTH_ERROR_CODES.InvalidCredentials), "errInvalidCredentials")
        assert.equal(authErrorKey(AUTH_ERROR_CODES.EmailNotConfirmed), "errEmailNotConfirmed")
        assert.equal(authErrorKey(AUTH_ERROR_CODES.TooManyAttempts), "errTooMany")
        assert.equal(authErrorKey("429"), "errTooMany")
        assert.equal(authErrorKey(AUTH_ERROR_CODES.PasswordInvalid), "errWeakPassword")
        assert.equal(authErrorKey(AUTH_ERROR_CODES.ResetTokenInvalid), "errLinkInvalid")
        assert.equal(authErrorKey("whatever"), "errGeneric")
        assert.equal(isLinkInvalid(AUTH_ERROR_CODES.ResetTokenInvalid), true)
        assert.equal(isLinkInvalid("x"), false)
    })

    it("rates a password by length and variety", () => {
        assert.equal(passwordStrength("short1A"), "weak")
        assert.equal(passwordStrength("alllowercaseletters"), "weak")
        assert.equal(passwordStrength("abcdefg1"), "ok")
        assert.equal(passwordStrength("Abcdefghi1"), "strong")
        assert.deepEqual([strengthKey("weak"), strengthKey("ok"), strengthKey("strong")], ["strengthWeak", "strengthOk", "strengthStrong"])
        assert.equal(EMAIL_PATTERN.test("a@b.co"), true)
        assert.equal(EMAIL_PATTERN.test("a@b"), false)
    })

    it("classifies statuses: only 401 and 403 are signed out, 429 and 5xx are passing", () => {
        assert.deepEqual([401, 403, 400, 404, 429, 500, 200].map(isSignedOutStatus), [true, true, false, false, false, false, false])
        assert.deepEqual([429, 500, 503, 400, 401].map(isTransientStatus), [true, true, true, false, false])
        assert.deepEqual([401, 404, 400, 409, 410, 422, 500].map(kindOfStatus), ["refused", "not-found", "invalid", "invalid", "invalid", "invalid", "unavailable"])
        assert.deepEqual(failureOfStatus(418, undefined), { success: false, message: "unavailable", error: "418" })
        assert.deepEqual(failureOfStatus(400, "CODE"), { success: false, message: "invalid", error: "CODE" })
    })
})
