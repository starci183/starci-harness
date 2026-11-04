import assert from "node:assert/strict"
import { test } from "node:test"
import { classifyFailure } from "./index.ts"

class SampleError extends Error {
    readonly code: string

    constructor(code: string) {
        super(code)
        this.code = code
    }
}

const withCode = (code: string): Error => Object.assign(new Error(code), { code })

test("a failureClass the error carries wins, and a value that is no class is ignored", () => {
    assert.equal(classifyFailure(Object.assign(new Error("bad row"), { failureClass: "input" }), SampleError), "input")
    assert.equal(classifyFailure(Object.assign(new SampleError("SAMPLE_INPUT_INVALID"), { failureClass: "transient" }), SampleError), "transient")
    assert.equal(classifyFailure(Object.assign(new Error("odd"), { failureClass: "sometimes" }), SampleError), "code")
})

test("an error of the app's domain family is config when its code names a configuration or connection, else input", () => {
    assert.equal(classifyFailure(new SampleError("SAMPLE_INPUT_INVALID"), SampleError), "input")
    assert.equal(classifyFailure(new SampleError("SAMPLE_CONFIG_MISSING"), SampleError), "config")
    assert.equal(classifyFailure(new SampleError("SAMPLE_CONNECTION_REFUSED"), SampleError), "config")
})

test("a dropped connection, a timeout or a lock conflict is transient; any other failure is code", () => {
    for (const code of ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "EPIPE", "40001", "40P01", "57P01"]) assert.equal(classifyFailure(withCode(code), SampleError), "transient", code)
    assert.equal(classifyFailure(withCode("ENOENT"), SampleError), "code")
    assert.equal(classifyFailure(Object.assign(new Error("numeric"), { code: 40001 }), SampleError), "code", "a non-string code is no driver code")
    assert.equal(classifyFailure(new Error("boom"), SampleError), "code")
    assert.equal(classifyFailure("text", SampleError), "code")
    assert.equal(classifyFailure(null, SampleError), "code")
})
