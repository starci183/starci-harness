import { Secret } from "@modules/platform/config"
import { PRIMARY_DATA_SOURCE } from "@modules/platform/database"
import { ACCESS_TOKEN_VERIFIER } from "@modules/domain/identity"
import { OWN_TOKEN_VERIFIER } from "@modules/integrations/passport"
import { OBJECT_STORAGE } from "@modules/integrations/object-storage"

/** Compiles the real API root with public configuration and explicit infrastructure doubles. */
export const buildWiringProof = () => ({
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
            google: { clientId: "fixture", clientSecret: new Secret("fixture-only"), callbackUrl: "https://api.fixture.example/auth/google/callback" },
            tokens: { issuer: "https://api.fixture.example", audience: "fixture", privateKey: new Secret("fixture-only"), keyId: "k1", accessTtlSeconds: 900 },
            refresh: { name: "refresh_token", path: "/auth/refresh", ttlSeconds: 2592000 },
        },
        objectStorage: {
            endpoint: "https://storage.fixture.example",
            region: "us-east-1",
            bucket: "fixture",
            accessKeyId: new Secret("fixture-only"),
            secretAccessKey: new Secret("fixture-only"),
            presignTtlSeconds: 300,
        },
    },
    overrides: [
        { token: PRIMARY_DATA_SOURCE, value: { manager: {} } },
        { token: OBJECT_STORAGE, value: {} },
        { token: OWN_TOKEN_VERIFIER, value: () => ({ ok: false }) },
        { token: ACCESS_TOKEN_VERIFIER, value: () => ({ ok: false }) },
    ],
})
