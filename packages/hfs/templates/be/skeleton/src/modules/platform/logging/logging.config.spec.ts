import { parseLoggingConfig, type LoggingEnv } from "./logging.config"

const envOf = (values: Readonly<Record<string, string>>): LoggingEnv => ({ optional: (key) => values[key] })

describe("parseLoggingConfig", () => {
    it("leaves Loki off when LOKI_URL is undeclared", () => {
        expect(parseLoggingConfig(envOf({ LOKI_APP: "shop" }), "api")).toEqual({})
    })

    it("reads the URL and the labels the stack render sets", () => {
        const options = parseLoggingConfig(
            envOf({
                LOKI_URL: "http://starci-monitor_loki:3100",
                LOKI_APP: "shop",
                LOKI_ENV: "production",
                LOKI_SERVICE: "worker",
            }),
            "api",
        )
        expect(options).toEqual({
            loki: {
                url: "http://starci-monitor_loki:3100",
                labels: { app: "shop", env: "production", service: "worker" },
            },
        })
    })

    it("names the service and a local environment when only LOKI_URL is declared", () => {
        expect(parseLoggingConfig(envOf({ LOKI_URL: "http://localhost:3100" }), "api").loki?.labels).toEqual({
            app: "api",
            env: "local",
            service: "api",
        })
    })

    it("keeps basic auth revealable for the transport and masked when serialized, and passes the tenant", () => {
        const loki = parseLoggingConfig(
            envOf({ LOKI_URL: "https://loki.example.org", LOKI_BASIC_AUTH: "u:p", LOKI_TENANT: "t-1" }),
            "api",
        ).loki
        expect(loki?.basicAuth?.reveal()).toBe("u:p")
        expect(JSON.stringify(loki)).not.toContain("u:p")
        expect(loki?.tenant).toBe("t-1")
    })
})
