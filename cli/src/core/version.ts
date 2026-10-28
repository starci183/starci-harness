import { readFileSync } from "node:fs"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../shared/verb.js"

interface VersionData {
    readonly version: string
    readonly node: string
}

/** The version of this CLI package (cli/package.json), "unknown" when it cannot be read. */
export const packageVersion = (): string => {
    const parsed: unknown = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"))
    if (typeof parsed === "object" && parsed !== null && "version" in parsed && typeof parsed.version === "string") return parsed.version
    return "unknown"
}

/** `starci version`: the CLI package version and the Node it runs on. */
export const versionVerb = defineVerb<VersionData, Record<string, never>>({
    path: ["version"],
    summary: "print the CLI version and the Node.js version it runs on",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/version@1",
    flags: {},
    run: () => {
        const data: VersionData = { version: packageVersion(), node: process.versions.node }
        return Promise.resolve({ data, message: `starci ${data.version} (node ${data.node})` })
    },
})
