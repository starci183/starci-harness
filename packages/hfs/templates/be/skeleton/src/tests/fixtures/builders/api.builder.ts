import { Secret } from "@modules/platform/config"
import { PRIMARY_DATA_SOURCE } from "@modules/platform/database"
import { ACCESS_TOKEN_VERIFIER } from "@modules/domain/identity"
import { OWN_TOKEN_VERIFIER } from "@modules/integrations/passport"
import { OBJECT_STORAGE } from "@modules/integrations/object-storage"

/** What a wiring proof hands the compiled root: public options and the infrastructure doubles. */
export interface WiringProof {
    readonly options: Readonly<Record<string, unknown>>
    readonly overrides: ReadonlyArray<{ readonly token: unknown; readonly value: unknown }>
}

/** Compiles the real API root with public configuration and explicit infrastructure doubles. */
export const buildWiringProof = (): WiringProof => ({
    options: {
        server: { port: 3000 },
        httpSecurity: {
            allowedOrigins: ["https://fixture.example"],
            rateLimit: { windowMs: 60000, defaultLimit: 100, strictLimit: 10 },
            webhooks: {},
        },
        http: {},
        database: {
            name: "primary",
            provider: "postgres",
            url: new Secret("postgresql://app_be@127.0.0.1:5432/postgres"),
            schema: "public",
        },
        passport: {
            issuer: "https://api.fixture.example",
            audience: "fixture",
            keys: [{ privateKey: new Secret("fixture-only"), keyId: "k1" }],
            accessTtlSeconds: 900,
            refreshTtlSeconds: 2592000,
            bcryptCost: 4,
            returnOrigin: "https://app.fixture.example",
            google: null,
            cookie: { name: "refresh_token" },
            budget: { loginAttempts: 10, resetAttempts: 5, windowMs: 900000 },
        },
        objectStorage: {
            endpoint: "https://storage.fixture.example",
            region: "us-east-1",
            bucket: "fixture",
            accessKeyId: new Secret("fixture-only"),
            secretAccessKey: new Secret("fixture-only"),
            defaultExpiresIn: 300,
        },
        mail: {
            host: "127.0.0.1",
            port: 2525,
            security: "none",
            from: { name: "Fixture", address: "no-reply@fixture.example" },
            webOrigin: "https://app.fixture.example",
            brandName: "Fixture",
            defaultLanguage: "en",
            confirmTtlSeconds: 86400,
            resetTtlSeconds: 3600,
        },
    },
    overrides: [
        { token: PRIMARY_DATA_SOURCE, value: { manager: {} } },
        { token: OBJECT_STORAGE, value: {} },
        { token: OWN_TOKEN_VERIFIER, value: () => ({ ok: false }) },
        { token: ACCESS_TOKEN_VERIFIER, value: () => ({ ok: false }) },
    ],
})
