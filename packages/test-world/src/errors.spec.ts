import assert from "node:assert/strict"
import { test } from "node:test"
import { DomainError, isDomainError } from "@starci/common"
import { TestWorldError, TestWorldErrorCode, worldError } from "./errors"

test("a TestWorldError is a DomainError that keeps its code, params, cause and message", () => {
    const cause = new Error("docker")
    const error = new TestWorldError({ code: TestWorldErrorCode.InfrastructureFailed, params: { detail: "no docker", attempt: 2 }, cause })
    assert.ok(error instanceof DomainError)
    assert.ok(isDomainError(error))
    assert.equal(error.name, "TestWorldError")
    assert.equal(error.code, "TEST_WORLD_INFRASTRUCTURE_FAILED")
    assert.equal(error.message, "TEST_WORLD_INFRASTRUCTURE_FAILED: no docker")
    assert.deepEqual(error.params, { detail: "no docker", attempt: 2 })
    assert.equal(error.cause, cause)
})

test("worldError builds the same error from a code and a detail, with no cause by default", () => {
    const error = worldError(TestWorldErrorCode.TimedOut, "waited")
    assert.ok(error instanceof TestWorldError)
    assert.equal(error.cause, undefined)
    assert.deepEqual(error.params, { detail: "waited" })
})
