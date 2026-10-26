import { existsSync, readFileSync, realpathSync } from "node:fs"
import { dirname, join, posix } from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"

/** The runtime gates the CLI implements: `starci check run` runs those a profile selects, in this order of cost. */
export const RUNTIME_GATES = ["secrets", "loosening", "canon", "typecheck", "lint"] as const

/** A runtime gate. */
export type RuntimeGate = (typeof RUNTIME_GATES)[number]

/** The gates CI runs on main after the push; the CLI only names them. */
export const CI_GATES = ["unit", "e2e", "build", "sonar-new-code"] as const

/** The actions that can wait for a green CI; deploy.prod is held by the deploy verb that ships it. */
export const CI_GATED_ACTIONS = ["release.cut", "release.publish", "deploy.prod"] as const

/** An action listed in requireCi. */
export type CiGatedAction = (typeof CI_GATED_ACTIONS)[number]

/** The loosening markers the CLI detects (cli/src/core/check/markers.ts). */
export const LOOSENING_MARKERS = [
    "eslint-disable",
    "stylelint-disable",
    "ts-ignore",
    "ts-nocheck",
    "ts-expect-error",
    "nosonar",
    "skipped-test",
    "focused-test",
    "or-true",
    "no-verify",
    "gate-widening",
] as const

/** One loosening marker. */
export type LooseningMarker = (typeof LOOSENING_MARKERS)[number]

/** The tools whose config a canon package provides; which file marks a tool's use is code (core/check/canon.ts). */
export const CANON_TOOLS = ["eslint", "stylelint", "tsconfig", "prettier", "jest"] as const

/** One canon tool. */
export type CanonTool = (typeof CANON_TOOLS)[number]

const ciGates = z.enum(CI_GATES)

const profileSchema = z.object({
    summary: z.string().min(1),
    canon: z.array(z.string().min(1)),
    runtime: z.array(z.enum(RUNTIME_GATES)).min(1),
    ci: z.array(ciGates),
})

/** One profile of quality.yaml: its canon stacks and the gates of each tier. */
export type Profile = z.infer<typeof profileSchema>

const qualitySchema = z.object({
    schema: z.literal("starci/quality-policy@1"),
    runtime: z.object({ stepTimeoutSeconds: z.number().int().positive().max(3600) }),
    requireCi: z.array(z.enum(CI_GATED_ACTIONS)),
    defaults: z.object({ none: z.string().min(1), app: z.string().min(1), runtime: z.string().min(1) }),
    profiles: z.record(z.string().min(1), profileSchema),
    ci: z.partialRecord(ciGates, z.record(z.string(), z.unknown())).optional(),
})

/** quality.yaml: the tiers, the profiles and the actions that wait for CI. */
export type QualityPolicy = z.infer<typeof qualitySchema>

const canonSchema = z.object({
    schema: z.literal("starci/canon-policy@1"),
    stacks: z.record(z.string().min(1), z.partialRecord(z.enum(CANON_TOOLS), z.string().regex(/^@[a-z0-9-]+\/[a-z0-9.-]+$/))),
})

/** canon.yaml: stack -> tool -> canon package name. */
export type CanonPolicy = z.infer<typeof canonSchema>

// An exception names one literal repository file: a glob or a folder would widen the gate past what was reviewed.
const literalPath = z
    .string()
    .min(1)
    .refine((path) => !/[*?[\]{}!]/.test(path) && !path.startsWith("/") && !path.split("/").includes("..") && !path.endsWith("/"), "an exception names one literal repository file")

const reason = z.string().trim().min(10, "an exception carries its reason")

const looseningException = z.object({ path: literalPath, marker: z.enum(LOOSENING_MARKERS), reason })

/** One declared loosening exception. */
export type LooseningException = z.infer<typeof looseningException>

const looseningSchema = z.object({
    schema: z.literal("starci/loosening-policy@1"),
    banned: z.array(z.enum(LOOSENING_MARKERS)).min(1),
    scan: z.object({ maxFileBytes: z.number().int().positive() }),
    exceptions: z.array(looseningException),
})

const looseningOverlay = z.object({
    schema: z.literal("starci/loosening-policy@1"),
    banned: z.array(z.enum(LOOSENING_MARKERS)).optional(),
    exceptions: z.array(looseningException).optional(),
})

/** loosening.yaml after the project's overlay: what is banned, how the scan is bounded, the declared exceptions. */
export type LooseningPolicy = z.infer<typeof looseningSchema>

const securityException = z.object({ path: literalPath, rule: z.string().min(1), reason })

/** One declared secret-scan exception. */
export type SecurityException = z.infer<typeof securityException>

const envelopeMode = z.enum(["allowed", "refused"])

const securitySchema = z.object({
    schema: z.literal("starci/security-policy@1"),
    sopsEnvelopes: z.object({ default: envelopeMode, profiles: z.record(z.string(), envelopeMode).optional() }),
    neverRead: z.array(z.string().min(1)),
    exceptions: z.array(securityException),
})

const securityOverlay = z.object({
    schema: z.literal("starci/security-policy@1"),
    neverRead: z.array(z.string().min(1)).optional(),
    exceptions: z.array(securityException).optional(),
})

/** security.yaml after the project's overlay. */
export type SecurityPolicy = z.infer<typeof securitySchema>

/** The runtime's policy files with a project's overlay applied. */
export interface Policy {
    readonly dir: string
    readonly overlay: string | undefined
    readonly quality: QualityPolicy
    readonly canon: CanonPolicy
    readonly loosening: LooseningPolicy
    readonly security: SecurityPolicy
}

/** The profile a project runs under and why. */
export interface ProfileChoice {
    readonly name: string
    readonly profile: Profile
    readonly source: string
}

/** The policy/ folder: STARCI_POLICY_DIR, else policy/ beside the CLI package (published copy), else the repository's policy/ above it. */
export const locatePolicy = (): string => {
    const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
    const candidates = [process.env.STARCI_POLICY_DIR, join(packageRoot, "policy"), join(packageRoot, "..", "policy")].filter((path): path is string => path !== undefined && path !== "")
    const found = candidates.find((path) => existsSync(join(path, "quality.yaml")))
    if (found === undefined) throw new Refusal("POLICY_NOT_FOUND", `no policy/ folder with quality.yaml (looked in ${candidates.join(", ")})`)
    return found
}

const readYaml = <T>(file: string, schema: z.ZodType<T>): T => {
    let raw: unknown
    try {
        raw = parse(readFileSync(file, "utf8"))
    } catch (error: unknown) {
        throw new Refusal("POLICY_INVALID", `${file} is not readable yaml: ${error instanceof Error ? error.message : String(error)}`)
    }
    const parsed = schema.safeParse(raw)
    if (!parsed.success) throw new Refusal("POLICY_INVALID", `${file} is invalid: ${z.prettifyError(parsed.error)}`)
    return parsed.data
}

const sameDir = (left: string, right: string): boolean => {
    try {
        const fold = (path: string): string => (process.platform === "win32" ? realpathSync(path).toLowerCase() : realpathSync(path))
        return fold(left) === fold(right)
    } catch {
        return false
    }
}

const POLICY_FILES = ["quality.yaml", "canon.yaml", "loosening.yaml", "security.yaml"]

/** The project's own policy/ folder at its repository root, when it is not the runtime's policy itself. */
const overlayDir = (dir: string, repositoryRoot: string | undefined): string | undefined => {
    if (repositoryRoot === undefined) return undefined
    const candidate = join(repositoryRoot, "policy")
    if (!existsSync(candidate) || sameDir(candidate, dir)) return undefined
    return POLICY_FILES.some((file) => existsSync(join(candidate, file))) ? candidate : undefined
}

const checkCrossReferences = (dir: string, quality: QualityPolicy, canon: CanonPolicy, security: SecurityPolicy): void => {
    const problems: string[] = []
    for (const [kind, name] of Object.entries(quality.defaults)) if (!(name in quality.profiles)) problems.push(`defaults.${kind} names unknown profile ${name}`)
    for (const [name, profile] of Object.entries(quality.profiles)) {
        for (const stack of profile.canon) if (!(stack in canon.stacks)) problems.push(`profile ${name} names unknown canon stack ${stack}`)
        if (profile.canon.length > 0 && !profile.runtime.includes("canon")) problems.push(`profile ${name} names canon stacks but its runtime tier has no canon gate`)
    }
    for (const name of Object.keys(security.sopsEnvelopes.profiles ?? {})) if (!(name in quality.profiles)) problems.push(`security sopsEnvelopes names unknown profile ${name}`)
    if (problems.length > 0) throw new Refusal("POLICY_INVALID", `${dir}: ${problems.join("; ")}`)
}

/**
 * Loads and validates the runtime's policy/, then applies the project's own policy/ at `repositoryRoot` when there is one.
 * An overlay only tightens: loosening.yaml may ban more and declare its exceptions, security.yaml may add neverRead globs and
 * exceptions; a project picks its profile in hfs.json, so it never carries quality.yaml or canon.yaml.
 */
export const loadPolicy = (repositoryRoot?: string, dir: string = locatePolicy()): Policy => {
    const quality = readYaml(join(dir, "quality.yaml"), qualitySchema)
    const canon = readYaml(join(dir, "canon.yaml"), canonSchema)
    let loosening = readYaml(join(dir, "loosening.yaml"), looseningSchema)
    let security = readYaml(join(dir, "security.yaml"), securitySchema)
    checkCrossReferences(dir, quality, canon, security)
    // The runtime's exceptions name the runtime repository's own files; any other repository starts with none.
    if (repositoryRoot !== undefined && !sameDir(join(repositoryRoot, "policy"), dir)) {
        loosening = { ...loosening, exceptions: [] }
        security = { ...security, exceptions: [] }
    }
    const overlay = overlayDir(dir, repositoryRoot)
    if (overlay !== undefined) {
        const refused = ["quality.yaml", "canon.yaml"].filter((file) => existsSync(join(overlay, file)))
        if (refused.length > 0) throw new Refusal("POLICY_OVERLAY_REFUSED", `${overlay} carries ${refused.join(" and ")}; a project picks its profile in hfs.json ("policy": "<profile>") and never redefines tiers or canon`)
        const looseningFile = join(overlay, "loosening.yaml")
        if (existsSync(looseningFile)) {
            const extra = readYaml(looseningFile, looseningOverlay)
            loosening = { ...loosening, banned: [...new Set([...loosening.banned, ...(extra.banned ?? [])])], exceptions: extra.exceptions ?? [] }
        }
        const securityFile = join(overlay, "security.yaml")
        if (existsSync(securityFile)) {
            const extra = readYaml(securityFile, securityOverlay)
            security = { ...security, neverRead: [...new Set([...security.neverRead, ...(extra.neverRead ?? [])])], exceptions: extra.exceptions ?? [] }
        }
    }
    return { dir, overlay, quality, canon, loosening, security }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

/**
 * The profile of the project at `treeRoot`: hfs.json's `policy` when it names one, else the default of its kind (the runtime,
 * an app) or of a folder with no hfs.json at all. A profile hfs.json names that quality.yaml lacks is refused.
 */
export const resolveProfile = (policy: Policy, treeRoot: string | undefined): ProfileChoice => {
    const { profiles, defaults } = policy.quality
    const pick = (name: string, source: string): ProfileChoice => {
        const profile = profiles[name]
        if (profile === undefined) throw new Refusal("POLICY_PROFILE_UNKNOWN", `${source} names profile ${name}; profiles: ${Object.keys(profiles).join(", ")}`)
        return { name, profile, source }
    }
    const file = treeRoot === undefined ? undefined : join(treeRoot, "hfs.json")
    if (file === undefined || !existsSync(file)) return pick(defaults.none, "default (no hfs.json)")
    let declared: unknown
    try {
        declared = JSON.parse(readFileSync(file, "utf8"))
    } catch (error: unknown) {
        throw new Refusal("POLICY_PROFILE_UNREADABLE", `${file} is not readable json: ${error instanceof Error ? error.message : String(error)}`)
    }
    const record = isRecord(declared) ? declared : {}
    if (record.policy !== undefined) {
        if (typeof record.policy !== "string" || record.policy === "") throw new Refusal("POLICY_PROFILE_UNKNOWN", `${file}: "policy" must name a profile`)
        return pick(record.policy, `${file} "policy"`)
    }
    return record.kind === "runtime" ? pick(defaults.runtime, "default (hfs.json kind runtime)") : pick(defaults.app, "default (hfs.json app)")
}

/** The canon packages of a profile, per tool: every stack it names contributes its package (several when stacks differ). */
export const canonOf = (policy: Policy, profile: Profile): Readonly<Partial<Record<CanonTool, readonly string[]>>> => {
    const byTool: Partial<Record<CanonTool, string[]>> = {}
    for (const stack of profile.canon) {
        for (const tool of CANON_TOOLS) {
            const name = policy.canon.stacks[stack]?.[tool]
            const known = byTool[tool] ?? []
            if (name !== undefined && !known.includes(name)) byTool[tool] = [...known, name]
        }
    }
    return byTool
}

/** True when the CLI must never open `file` (repository-relative, forward slashes). */
export const neverRead = (policy: Policy, file: string): boolean => policy.security.neverRead.some((pattern) => posix.matchesGlob(file, pattern))

/** Whether the profile tolerates sops envelopes in the tree. */
export const envelopesAllowed = (policy: Policy, profile: string): boolean => (policy.security.sopsEnvelopes.profiles?.[profile] ?? policy.security.sopsEnvelopes.default) === "allowed"
