import { Secret } from "@modules/platform/config"
import { createObjectStorage } from "./object-storage.client"

const options = {
    endpoint: "http://127.0.0.1:9000",
    region: "us-east-1",
    bucket: "app",
    accessKeyId: new Secret("access"),
    secretAccessKey: new Secret("secret"),
    presignTtlSeconds: 300,
}

describe("createObjectStorage", () => {
    it("presigns a path-style PUT of one key in the bucket, valid for the configured lifetime", async () => {
        const storage = createObjectStorage(options, () => new Date("2026-10-29T00:00:00.000Z"))
        const request = await storage.presignPut("users/u1/avatar.png", "image/png")

        expect(new URL(request.url).pathname).toBe("/app/users/u1/avatar.png")
        expect(new URL(request.url).searchParams.get("X-Amz-Expires")).toBe("300")
        expect(request.expiresAt).toBe("2026-10-29T00:05:00.000Z")
    })
})
