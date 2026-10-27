import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { EventStreamError, EventStreamErrorCode, isEventStreamError } from "./errors.js"

describe("EventStreamError", () => {
  it("carries the code, status and request like an axios error", () => {
    const config = { url: "/s", headers: {}, path: "/s", attempt: 0, lastEventId: undefined }
    const error = new EventStreamError("nope", EventStreamErrorCode.BadRequest, { status: 404, config, retryable: false })
    assert.equal(error.name, "EventStreamError")
    assert.equal(error.code, "ERR_BAD_REQUEST")
    assert.equal(error.status, 404)
    assert.equal(error.config, config)
    assert.equal(error.response, undefined)
    assert.equal(error.retryable, false)
    assert.equal(error.cause, undefined)
    assert.ok(error instanceof Error)
    assert.deepEqual(error.toJSON(), { name: "EventStreamError", message: "nope", code: "ERR_BAD_REQUEST", status: 404, retryable: false, config })
  })

  it("keeps the cause and the retryable flag", () => {
    const cause = new Error("root")
    const error = new EventStreamError("net", EventStreamErrorCode.Network, { cause, retryable: true })
    assert.equal(error.cause, cause)
    assert.equal(error.retryable, true)
  })

  it("recognises its own kind", () => {
    assert.equal(isEventStreamError(new EventStreamError("x", EventStreamErrorCode.Frame)), true)
    assert.equal(isEventStreamError(null), false)
    assert.equal(isEventStreamError("x"), false)
    assert.equal(isEventStreamError(new Error("x")), false)
    assert.equal(isEventStreamError({ isEventStreamError: false }), false)
  })
})
