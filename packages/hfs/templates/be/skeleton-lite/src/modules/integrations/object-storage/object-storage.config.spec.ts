import { EnvSource } from "@modules/platform/config"
import { parseObjectStorageConfig } from "./object-storage.config"

const REQUIRED = {
    STORAGE_ENDPOINT: "http://127.0.0.1:9000",
    STORAGE_REGION: "us-east-1",
    STORAGE_BUCKET: "app",
    STORAGE_ACCESS_KEY_ID: "access",
    STORAGE_SECRET_ACCESS_KEY: "secret",
}

describe("parseObjectStorageConfig", () => {
    it("reads the endpoint, region, bucket and secrets, with a presign lifetime of five minutes by default", () => {
        const options = parseObjectStorageConfig(new EnvSource(REQUIRED))

        expect(options).toMatchObject({ endpoint: "http://127.0.0.1:9000", region: "us-east-1", bucket: "app", defaultExpiresIn: 300 })
        expect(options.accessKeyId).not.toBe("access")
        expect(JSON.stringify(options)).not.toContain("secret")
    })

    it("reads a declared presign lifetime", () => {
        expect(parseObjectStorageConfig(new EnvSource({ ...REQUIRED, STORAGE_PRESIGN_TTL_SECONDS: "900" })).defaultExpiresIn).toBe(900)
    })

    it("refuses a missing endpoint", () => {
        expect(() => parseObjectStorageConfig(new EnvSource({ ...REQUIRED, STORAGE_ENDPOINT: "" }))).toThrow()
    })
})
