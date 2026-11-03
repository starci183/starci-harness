import "reflect-metadata"
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { Injectable, Module } from "@nestjs/common"
import type { DynamicModule } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import type { PrincipalVerifier as LitePrincipalVerifier } from "@starci/auth/server"
import { OIDC_ERROR_CODES } from "../contracts/index.ts"
import { FakeOidcIssuer } from "../testing/index.ts"
import type { OidcClient } from "./client.ts"
import { OidcError } from "./errors.ts"
import { OidcModule } from "./oidc.module.ts"
import { OIDC_CLIENT, OIDC_DISCOVERY, OIDC_KEYS, OIDC_PRINCIPAL_VERIFIER, OIDC_TOKEN_VERIFIER } from "./oidc.tokens.ts"
import type { OidcOptions } from "./options.ts"
import type { OidcPrincipalVerifier } from "./verifier.ts"

const CALLBACK = "https://app.example.test/callback"

describe("OidcModule", () => {
    it("registers the verifier, the keys, the discovery and the code flow client from options known now", async () => {
        const issuer = await FakeOidcIssuer.create()
        const moduleRef = await Test.createTestingModule({ imports: [OidcModule.register(issuer.options({ callbackUri: CALLBACK }))] }).compile()
        const lite: LitePrincipalVerifier = moduleRef.get<OidcPrincipalVerifier>(OIDC_PRINCIPAL_VERIFIER)
        const outcome = await lite.verify(await issuer.mintAccessToken({ sub: "u-1" }))
        assert.equal(outcome.kind, "ok")
        assert.ok(moduleRef.get<OidcClient | null>(OIDC_CLIENT))
        for (const token of [OIDC_DISCOVERY, OIDC_KEYS, OIDC_TOKEN_VERIFIER]) assert.ok(moduleRef.get(token))
    })

    it("registers from a factory that supplies the app's settings, and the client is null without a client registration", async () => {
        const issuer = await FakeOidcIssuer.create()
        let asked = 0
        const moduleRef = await Test.createTestingModule({
            imports: [
                OidcModule.registerAsync({
                    useFactory: (): OidcOptions => {
                        asked += 1
                        return issuer.options()
                    },
                }),
            ],
        }).compile()
        assert.equal(asked, 1)
        assert.equal(moduleRef.get<OidcClient | null>(OIDC_CLIENT), null)
        assert.equal((await moduleRef.get<OidcPrincipalVerifier>(OIDC_PRINCIPAL_VERIFIER).verify(await issuer.mintAccessToken())).kind, "ok")
    })

    it("is global when the root says so, so a provider anywhere injects the verifier without importing the module", async () => {
        const issuer = await FakeOidcIssuer.create()
        class Guard {
            readonly verifier: unknown = undefined
        }
        Injectable()(Guard)
        class FeatureModule {
            readonly name = "feature"
        }
        Module({ providers: [{ provide: Guard, inject: [OIDC_PRINCIPAL_VERIFIER], useFactory: (verifier: OidcPrincipalVerifier): Guard => Object.assign(new Guard(), { verifier }) }] })(FeatureModule)
        const global: DynamicModule = OidcModule.register({ ...issuer.options(), isGlobal: true })
        assert.equal(global.global, true)
        const moduleRef = await Test.createTestingModule({ imports: [global, FeatureModule] }).compile()
        assert.ok(moduleRef.get(Guard).verifier)
    })

    it("fails the boot with a configuration error when the options do not meet the contract", async () => {
        const issuer = await FakeOidcIssuer.create()
        await assert.rejects(
            Test.createTestingModule({ imports: [OidcModule.register(issuer.options({ algorithms: ["none" as never] }))] }).compile(),
            (error: unknown) => error instanceof OidcError && error.code === OIDC_ERROR_CODES.ConfigurationInvalid,
        )
    })
})
