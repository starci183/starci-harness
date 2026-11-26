import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { NextConfig } from "next"

/** The `next/image` remote patterns of the repo-owned statics: the origin and path of NEXT_PUBLIC_STATICS_URL, when the build holds it. */
const staticsPatterns = (): NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]> => {
    const base = process.env.NEXT_PUBLIC_STATICS_URL
    if (base === undefined || base === "") return []
    const url = new URL(base)
    return [
        {
            protocol: url.protocol === "https:" ? "https" : "http",
            hostname: url.hostname,
            port: url.port,
            pathname: `${url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname}/**`,
        },
    ]
}
import createNextIntlPlugin from "next-intl/plugin"

/** The request config lives in this app's i18n module. */
const withNextIntl = createNextIntlPlugin("./src/modules/i18n/request.ts")

/** The npm workspace root, used by Turbopack and output tracing. */
const WORKSPACE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")

/** Next config of the web app. */
const nextConfig: NextConfig = {
    output: "standalone",
    reactStrictMode: true,
    experimental: { rootParams: true },
    outputFileTracingRoot: WORKSPACE_ROOT,
    turbopack: { root: WORKSPACE_ROOT },
    poweredByHeader: false,
    images: { remotePatterns: staticsPatterns() },
}

export default withNextIntl(nextConfig)
