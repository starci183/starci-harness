import { BoundedLokiTransport } from "./loki-transport.adapter"

const MESSAGE = Symbol.for("message")
const LEVEL = Symbol.for("level")

/** A line as the logger hands it to a transport: the finished JSON under MESSAGE. */
const line = (index: number) => ({
    level: "info",
    message: "cart.opened",
    [LEVEL]: "info",
    [MESSAGE]: `{"n":${String(index)}}`,
})

describe("BoundedLokiTransport", () => {
    it("holds at most maxBuffered lines and counts the ones it drops while Loki cannot take them", async () => {
        // port 1 refuses every connection: nothing leaves the batch before close
        const transport = new BoundedLokiTransport(
            {
                url: "http://127.0.0.1:1",
                labels: { app: "shop", env: "dev", service: "api" },
                maxBuffered: 2,
                timeoutMs: 300,
            },
            () => undefined,
        )
        const next = jest.fn()
        for (const index of [1, 2, 3]) transport.log(line(index), next)
        expect(transport.dropped).toBe(1)
        expect(next).toHaveBeenCalledTimes(3)
        await expect(transport.close()).resolves.toBeUndefined()
    })

    it("reports a failed push to its owner instead of throwing", async () => {
        const failures: Array<unknown> = []
        const transport = new BoundedLokiTransport(
            { url: "http://127.0.0.1:1/", labels: { app: "shop", env: "dev", service: "api" }, timeoutMs: 300 },
            (cause) => failures.push(cause),
        )
        transport.log(line(1), () => undefined)
        await transport.close()
        expect(failures).toHaveLength(1)
    })
})
