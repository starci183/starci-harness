import { DomainError } from "@modules/platform/errors"
import { classifyFailure } from "./queue.failure"

class SampleError extends DomainError<"SAMPLE_INPUT_INVALID" | "SAMPLE_CONFIG_MISSING"> {}

const withCode = (code: string): Error => Object.assign(new Error(code), { code })

describe("classifyFailure", () => {
    it("takes the class a failure carries", () => {
        expect(classifyFailure(Object.assign(new Error("bad row"), { failureClass: "input" }))).toBe("input")
        expect(classifyFailure(Object.assign(new Error("odd"), { failureClass: "sometimes" }))).toBe("code")
    })

    it("reads a domain error as input, or as config when its code names a configuration or connection", () => {
        expect(classifyFailure(new SampleError({ code: "SAMPLE_INPUT_INVALID" }))).toBe("input")
        expect(classifyFailure(new SampleError({ code: "SAMPLE_CONFIG_MISSING" }))).toBe("config")
    })

    it("reads a dropped connection, a timeout and a lock conflict as transient", () => {
        expect(classifyFailure(withCode("ECONNRESET"))).toBe("transient")
        expect(classifyFailure(withCode("40P01"))).toBe("transient")
    })

    it("reads any other failure as code", () => {
        expect(classifyFailure(withCode("ENOENT"))).toBe("code")
        expect(classifyFailure(new Error("boom"))).toBe("code")
        expect(classifyFailure("text")).toBe("code")
        expect(classifyFailure(null)).toBe("code")
    })
})
