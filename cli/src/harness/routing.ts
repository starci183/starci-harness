import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"
import { locateOps } from "./ops.js"

const difficultySchema = z.enum(["easy", "medium", "hard", "insane"])

/** A coordinator seat whose tier is owned by ops/routing.yaml. */
export type CoordinatorRole = "supervisor" | "kernel"

/** A difficulty by name, from easy to insane. */
export type Difficulty = z.infer<typeof difficultySchema>

const memberSchema = z.object({ agent: z.string().min(1), model: z.string().min(1), effort: z.string().min(1).optional() })

/** One member of a tier chain as ops/routing.yaml writes it. */
export type MemberSpec = z.infer<typeof memberSchema>

const poolSchema = z.object({
    provider: z.string().min(1),
    maxParallel: z.number().int().positive(),
    labels: z.array(z.string().min(1)),
    tools: z.array(z.string().min(1)),
})

/** One pool: a provider quota window with its parallel slots, the labels it takes and the tools its agent has. */
export type PoolSpec = z.infer<typeof poolSchema>

const minutes = z.number().nonnegative()

/** The failure kinds a provider outcome can carry; each has its own circuit cooldown. */
export const FAILURE_KINDS = ["rate", "quota", "capacity", "auth", "launch"] as const

/** A provider failure kind. */
export type FailureKind = (typeof FAILURE_KINDS)[number]

const kindRecord = <T extends z.ZodType>(value: T) => z.partialRecord(z.enum(FAILURE_KINDS), value)

const routingSchema = z.object({
    schema: z.literal("starci/routing@1"),
    difficulties: z.tuple([z.literal("easy"), z.literal("medium"), z.literal("hard"), z.literal("insane")]),
    difficultyTier: z.record(difficultySchema, z.string().min(1)),
    labelTiers: z.record(z.string(), z.string().min(1)),
    coordinators: z.object({ supervisor: z.string().min(1), kernel: z.string().min(1) }),
    tierOrder: z.array(z.string().min(1)).min(1),
    escalateAfterReds: z.number().int().positive(),
    tiers: z.record(z.string(), z.array(memberSchema).min(1)),
    pools: z.record(z.string(), poolSchema),
    hostProbes: z.record(z.string(), z.array(z.string().min(1)).min(1)),
    balance: z.object({ maxStreak: z.number().int().positive(), maxSharePercent: z.number().positive().max(100) }),
    quota: z.object({ reservePercent: z.number(), biasPercent: z.number(), exhaustedPercent: z.number(), maxAgeMinutes: minutes }),
    circuit: z.object({
        cooldownMinutes: z.object({ rate: minutes, quota: minutes, capacity: minutes, auth: minutes, launch: minutes }),
        strikes: kindRecord(z.number().int().positive()),
        reopenFactor: z.number().min(1),
        reopenWindowMinutes: minutes,
        capMinutes: minutes,
    }),
    failureSignals: kindRecord(z.array(z.string().min(1))),
    concurrency: z.object({ floor: z.number().int().positive(), decreaseCooldownMinutes: minutes, quietMinutes: minutes, increaseStepMinutes: minutes }),
    budgets: z.object({ workflow: z.object({ minutes: z.number().int().positive(), tries: z.number().int().positive() }) }),
})

/** ops/routing.yaml, validated: tiers, pools, quota, circuit, concurrency and budgets. */
export type Routing = z.infer<typeof routingSchema>

// Cross-field rules zod cannot state: every tier named exists, every member's agent has its pool (pools are keyed by agent,
// so an agent has exactly one), the quota bands rise and every signal compiles.
const problemsOf = (routing: Routing): string[] => {
    const problems: string[] = []
    const tiers = new Set(Object.keys(routing.tiers))
    for (const tier of [...routing.tierOrder, ...Object.values(routing.difficultyTier), ...Object.values(routing.labelTiers), ...Object.values(routing.coordinators)]) {
        if (!tiers.has(tier)) problems.push(`tier ${tier} is named but not defined under tiers`)
    }
    for (const tier of tiers) if (!routing.tierOrder.includes(tier)) problems.push(`tier ${tier} is missing from tierOrder`)
    for (const [tier, members] of Object.entries(routing.tiers)) {
        for (const member of members) if (!(member.agent in routing.pools)) problems.push(`tier ${tier} names agent ${member.agent}, which has no pool`)
    }
    const { reservePercent, biasPercent, exhaustedPercent } = routing.quota
    if (!(reservePercent <= biasPercent && biasPercent <= exhaustedPercent)) problems.push("quota needs reservePercent <= biasPercent <= exhaustedPercent")
    problems.push(...signalProblems(routing))
    return problems
}

/** True when the pattern compiles as a case-insensitive regular expression. */
const compiles = (pattern: string): boolean => {
    try {
        return new RegExp(pattern, "i").ignoreCase
    } catch {
        return false
    }
}

const signalProblems = (routing: Routing): string[] =>
    Object.entries(routing.failureSignals).flatMap(([kind, patterns]) => patterns.filter((pattern) => !compiles(pattern)).map((pattern) => `failureSignals.${kind} has an invalid pattern: ${pattern}`))

const loaded = new Map<string, Routing>()

/** Loads and validates ops/routing.yaml from the ops folder (STARCI_OPS_DIR honoured); read once per process. */
export const loadRouting = (dir: string = locateOps()): Routing => {
    const known = loaded.get(dir)
    if (known !== undefined) return known
    const file = join(dir, "routing.yaml")
    let raw: unknown
    try {
        raw = parse(readFileSync(file, "utf8"))
    } catch (error: unknown) {
        throw new Refusal("OPS_INVALID", `${file} is not readable yaml: ${error instanceof Error ? error.message : String(error)}`)
    }
    const parsed = routingSchema.safeParse(raw)
    if (!parsed.success) throw new Refusal("OPS_INVALID", `${file} is invalid: ${z.prettifyError(parsed.error)}`)
    const problems = problemsOf(parsed.data)
    if (problems.length > 0) throw new Refusal("OPS_INVALID", `${file} is inconsistent:\n${problems.join("\n")}`)
    loaded.set(dir, parsed.data)
    return parsed.data
}

/** The pool id of an agent: pools are keyed by the agent that launches in them. */
export const poolOfAgent = (routing: Routing, agent: string): string | undefined => (agent in routing.pools ? agent : undefined)

/** The provider of an agent (its pool's provider), else the agent itself: a circuit is per provider. */
export const providerOfAgent = (routing: Routing, agent: string): string => routing.pools[agent]?.provider ?? agent

/** The pools that draw on one provider. */
export const poolsOfProvider = (routing: Routing, provider: string): string[] =>
    Object.entries(routing.pools)
        .filter(([, pool]) => pool.provider === provider)
        .map(([id]) => id)

/** Reads a difficulty given by name or as 1..4; refuses anything else. */
export const parseDifficulty = (routing: Routing, value: string | number): Difficulty => {
    const text = String(value).trim().toLowerCase()
    const byName = difficultySchema.safeParse(text)
    if (byName.success) return byName.data
    const index = Number(text)
    const named = Number.isInteger(index) ? routing.difficulties[index - 1] : undefined
    if (named === undefined) throw new Refusal("CLI_USAGE", `difficulty is one of ${routing.difficulties.join(", ")} or 1..${String(routing.difficulties.length)}, not "${text}"`, 2)
    return named
}

/** The rank of a difficulty, easy first. */
export const difficultyRank = (routing: Routing, difficulty: Difficulty): number => routing.difficulties.indexOf(difficulty)

/** Minutes as milliseconds. */
export const minutesMs = (value: number): number => value * 60_000
