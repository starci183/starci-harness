import { git } from "../../shared/git.js"
import { LOOPBACK, PORT } from "./local-registry.js"

/**
 * DEV-ONLY LOCAL-REGISTRY PINS (owner 2026-11-22: "test local là nhánh dev mà nó dùng local để test output chứ ci gì ở đâu ông").
 * An app may declare in its hfs.json `"deps": { "devAllowsLocalRegistry": true }`: its dev branch (and a lane branch, which lands on dev)
 * may then carry exact local-registry pins of the harness packages and the lockfile entries their install writes, so dev runs the
 * unreleased output at once. The push gate accepts DEPS_PIN_UNPUBLISHED for a version the local registry serves,
 * DEPS_LOCAL_REGISTRY_COMMITTED for references to that registry only, and DEPS_LOCK_INTEGRITY, and prints one note naming them.
 * Only a push whose every target ref is dev or a lane branch qualifies: `release push`, `release cut`, `app release`, a prod deploy and a
 * push of main, a release branch or a tag pass no such target and keep refusing (a prod cut holds npm versions). No environment bypass.
 */
export const DEPS_KEY = "deps"
export const DEV_LOCAL_KEY = "devAllowsLocalRegistry"

/** The codes a declared dev push accepts. */
export const DEV_LOCAL_CODES = Object.freeze(["DEPS_PIN_UNPUBLISHED", "DEPS_LOCAL_REGISTRY_COMMITTED", "DEPS_LOCK_INTEGRITY"] as const)
export type DevLocalCode = (typeof DEV_LOCAL_CODES)[number]

/** Where a push goes: the remote refs it updates (git's pre-push stdin, third field). */
export interface PushTarget {
    readonly refs: readonly string[]
}

const DEV_REF = "refs/heads/dev"
const LANE_REF = /^refs\/heads\/lane\/[^\s]+$/

/** The remote refs of git's pre-push stdin (`<local ref> <local sha> <remote ref> <remote sha>` per line); malformed lines are skipped. */
export const prePushTarget = (text: string): PushTarget => ({
    refs: text
        .split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/))
        .filter((parts) => parts.length === 4)
        .map((parts) => parts[2] ?? ""),
})

/** True when the push lands on dev: at least one ref, and every ref is dev or a lane branch (which lands on dev). Main, a release branch or a tag in the same push disqualify it. */
export const landsOnDev = (target: PushTarget | undefined): boolean =>
    target !== undefined && target.refs.length > 0 && target.refs.every((ref) => ref === DEV_REF || LANE_REF.test(ref))

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** Whether the hfs.json committed at `revision` declares `deps.devAllowsLocalRegistry: true` (a working-tree edit never counts). */
export const declaresDevLocal = async (root: string, revision: string): Promise<boolean> => {
    let text: string
    try {
        text = await git(root, ["show", `${revision}:hfs.json`])
    } catch {
        return false
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(text)
    } catch {
        return false
    }
    if (!isRecord(parsed)) return false
    const deps = parsed[DEPS_KEY]
    return isRecord(deps) && deps[DEV_LOCAL_KEY] === true
}

/** The address of the local registry (`http://127.0.0.1:4873`): the only machine registry a dev push may name. */
export const LOCAL_REGISTRY_ADDRESS = `http://${LOOPBACK}:${String(PORT)}`

/** Whether a committed URL names exactly the local registry. */
export const namesLocalRegistry = (url: string): boolean => {
    try {
        const parsed = new URL(url.replace(/^\/\//, "http://"))
        return `${parsed.protocol}//${parsed.host}` === LOCAL_REGISTRY_ADDRESS
    } catch {
        return false
    }
}

/** An exact version (`0.55.0-content.4`), the only pin a dev push may hold from the local registry. */
export const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

/** The one note line of a dev push that accepted codes. */
export const devLocalNote = (refs: readonly string[], accepted: readonly DevLocalCode[]): string =>
    `dev-local: ${refs.join(", ")} of an app declaring hfs.json deps.${DEV_LOCAL_KEY} accepts ${accepted.join(", ")} (local registry ${LOCAL_REGISTRY_ADDRESS}); release push, release cut, app release, a prod deploy and a push of main refuse them`
