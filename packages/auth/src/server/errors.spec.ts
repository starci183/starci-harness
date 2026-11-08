import assert from "node:assert/strict"
import { test } from "node:test"
import { DomainError, isDomainError } from "@starci/common"
import { AUTH_ERROR_CODES } from "../contracts/index.ts"
import { AuthError } from "./errors.ts"

test("an AuthError is a DomainError that keeps its code, kind, context and cause", () => {
    const cause = new Error("db")
    const error = new AuthError(AUTH_ERROR_CODES.TooManyAttempts, { cause, context: { ip: "x" } })
    assert.ok(error instanceof DomainError)
    assert.equal(isDomainError(error), true)
    assert.equal(error.name, "AuthError")
    assert.equal(error.message, AUTH_ERROR_CODES.TooManyAttempts)
    assert.equal(error.code, AUTH_ERROR_CODES.TooManyAttempts)
    assert.equal(error.kind, "rate-limited")
    assert.deepEqual(error.context, { ip: "x" })
    assert.deepEqual(error.params, {})
    assert.equal(error.cause, cause)
})

test("an AuthError without options has an empty context and no cause", () => {
    const error = new AuthError(AUTH_ERROR_CODES.Unauthenticated)
    assert.deepEqual(error.context, {})
    assert.equal(error.cause, undefined)
})
