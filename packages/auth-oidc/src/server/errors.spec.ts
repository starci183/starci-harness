import assert from "node:assert/strict"
import { test } from "node:test"
import { DomainError, isDomainError } from "@starci/common"
import { OIDC_ERROR_CODES } from "../contracts/index.ts"
import { OidcError } from "./errors.ts"

test("an OidcError is a DomainError that keeps its code, kind, params and cause", () => {
    const cause = new Error("down")
    const error = new OidcError(OIDC_ERROR_CODES.Unavailable, { cause, params: { key: "issuer" } })
    assert.ok(error instanceof DomainError)
    assert.equal(isDomainError(error), true)
    assert.equal(error.name, "OidcError")
    assert.equal(error.message, OIDC_ERROR_CODES.Unavailable)
    assert.equal(error.code, OIDC_ERROR_CODES.Unavailable)
    assert.equal(error.kind, "unavailable")
    assert.deepEqual(error.params, { key: "issuer" })
    assert.equal(error.cause, cause)
})

test("an OidcError without options has empty params and no cause", () => {
    const error = new OidcError(OIDC_ERROR_CODES.Rejected)
    assert.deepEqual(error.params, {})
    assert.equal(error.cause, undefined)
})
