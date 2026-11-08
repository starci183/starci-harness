import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { DomainError, isDomainError } from "@starci/common"
import { AI_ROUTER_ERROR_CODES, AiRouterError } from "../src/errors.ts"
import { KeyAdminError, MountedKeyError } from "../src/gateway/keys.ts"

describe("the errors of the package are DomainErrors", () => {
    test("an AiRouterError is coded by its class and keeps its sentence as the message", () => {
        const error = new AiRouterError({ errorClass: "quota", message: "the pool is spent" })
        assert.ok(error instanceof DomainError)
        assert.ok(isDomainError(error))
        assert.equal(error.code, "AI_ROUTER_QUOTA")
        assert.equal(error.message, "the pool is spent")
        assert.equal(error.name, "AiRouterError")
        assert.equal(error.errorClass, "quota")
        assert.deepEqual(error.params, {})
    })

    test("every error class has its own code", () => {
        const codes = Object.values(AI_ROUTER_ERROR_CODES)
        assert.equal(new Set(codes).size, codes.length)
        assert.equal(AI_ROUTER_ERROR_CODES.no_candidate, "AI_ROUTER_NO_CANDIDATE")
    })

    test("KeyAdminError and MountedKeyError keep their codes, messages and names", () => {
        const admin = new KeyAdminError("mounted", "a mounted key does not change")
        assert.ok(isDomainError(admin))
        assert.equal(admin.code, "mounted")
        assert.equal(admin.message, "a mounted key does not change")
        assert.equal(admin.name, "KeyAdminError")
        const mounted = new MountedKeyError("collision", "prod", "the secret is held twice")
        assert.ok(isDomainError(mounted))
        assert.equal(mounted.code, "collision")
        assert.equal(mounted.label, "prod")
        assert.equal(mounted.message, "the secret is held twice")
        assert.equal(mounted.name, "MountedKeyError")
    })
})
