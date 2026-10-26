import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Refusal } from "../../shared/errors.js"
import { EVERYONE, defineVerb } from "../../shared/verb.js"

interface DeclaredApp {
    readonly name: string
    readonly kind: string
}

interface AppInfoData {
    readonly root: string
    readonly project: string | null
    readonly beApps: readonly DeclaredApp[]
    readonly feApps: readonly DeclaredApp[]
    readonly patterns: readonly string[]
    readonly backing: readonly string[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

const appsOf = (value: unknown): DeclaredApp[] =>
    Array.isArray(value)
        ? value.filter(isRecord).flatMap((app) => (typeof app.name === "string" && typeof app.kind === "string" ? [{ name: app.name, kind: app.kind }] : []))
        : []

const stringsOf = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [])

const listOf = (items: readonly string[]): string => (items.length === 0 ? "-" : items.join(", "))

/** `starci app info`: what a lite app declares in hfs.json, so an agent in chat knows its apps and patterns before it codes. */
export const appInfoVerb = defineVerb({
    path: ["app", "info"],
    summary: "show what this lite app declares: back-end and front-end apps, canonical patterns and backing services",
    editions: ["lite"],
    effect: "read",
    roles: EVERYONE,
    schema: "starci/app-info@1",
    flags: {},
    run: (context) => {
        if (context.treeRoot === undefined || context.tree !== "lite") throw new Refusal("APP_NOT_LITE", "run this inside a lite app (an hfs.json with edition lite)")
        const parsed: unknown = JSON.parse(readFileSync(join(context.treeRoot, "hfs.json"), "utf8"))
        const declaration = isRecord(parsed) ? parsed : {}
        const sides = isRecord(declaration.sides) ? declaration.sides : {}
        const be = isRecord(sides.be) ? sides.be : {}
        const fe = isRecord(sides.fe) ? sides.fe : {}
        const data: AppInfoData = {
            root: context.treeRoot,
            project: typeof declaration.project === "string" ? declaration.project : null,
            beApps: appsOf(be.apps),
            feApps: appsOf(fe.apps),
            patterns: stringsOf(be.patterns),
            backing: stringsOf(be.backing),
        }
        const named = (apps: readonly DeclaredApp[]): string => listOf(apps.map((app) => `${app.name} (${app.kind})`))
        const message = [
            `lite app ${data.project ?? ""} at ${data.root}`.replace("  ", " "),
            `be: ${named(data.beApps)}`,
            `fe: ${named(data.feApps)}`,
            `patterns: ${listOf(data.patterns)}`,
            `backing: ${listOf(data.backing)}`,
        ].join("\n")
        return Promise.resolve({ data, message })
    },
})
