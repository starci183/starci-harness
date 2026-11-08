import assert from "node:assert/strict"
import { test } from "node:test"
import { DomainError, ok, refused, unwrapOutcome } from "./index.ts"

type CapabilityErrorCode = "CAPABILITY_REFUSED"

class CapabilityError extends DomainError<CapabilityErrorCode> {}

/** What `run` throws, read as `unknown`; the assertions then judge its fields. */
const thrownBy = (run: () => unknown): unknown => {
    try {
        run()
    } catch (error) {
        return error
    }
    return undefined
}

test("ok wraps the produced value as a success", () => {
    const value = { id: "value-1" }
    assert.deepEqual(ok(value), { kind: "ok", value })
})

test("refused wraps the capability code and the display parameters", () => {
    assert.deepEqual(refused("CAPABILITY_REFUSED", { resource: "value-1" }), {
        kind: "refused",
        code: "CAPABILITY_REFUSED",
        params: { resource: "value-1" },
    })
})

test("refused keeps the display parameters optional and absent", () => {
    const refusal = refused("CAPABILITY_REFUSED")
    assert.deepEqual(refusal, { kind: "refused", code: "CAPABILITY_REFUSED" })
    assert.equal("params" in refusal, false)
})

test("unwrapOutcome returns the value of a success", () => {
    assert.equal(unwrapOutcome(ok("value-1"), CapabilityError), "value-1")
})

test("unwrapOutcome turns a refusal into the capability error with its parameters", () => {
    const thrown = thrownBy(() => unwrapOutcome(refused<CapabilityErrorCode>("CAPABILITY_REFUSED", { resource: "value-1" }), CapabilityError))
    assert.ok(thrown instanceof CapabilityError)
    assert.equal(thrown.name, "CapabilityError")
    assert.equal(thrown.code, "CAPABILITY_REFUSED")
    assert.deepEqual(thrown.params, { resource: "value-1" })
})

test("unwrapOutcome builds the error without parameters from a refusal that has none", () => {
    const thrown = thrownBy(() => unwrapOutcome(refused<CapabilityErrorCode>("CAPABILITY_REFUSED"), CapabilityError))
    assert.ok(thrown instanceof CapabilityError)
    assert.deepEqual(thrown.params, {})
})
