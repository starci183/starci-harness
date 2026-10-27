import type { ActionResult, ConfigEntry } from "@contract"
import { useMemo, useState } from "react"
import { useActionCommand, useConfigQuery } from "../../../hooks/query"
import { slotOfQuery, useSlotLabels } from "../../../hooks/slot"
import type { DataSlot } from "../../../modules/types"
import { CONFIG_GROUPS, EFFORT_OPTIONS, SETTINGS, TIER, configFieldLabel } from "../../../modules/i18n"
import type { ConfigFieldView, ConfigValue } from "../../composites/ConfigField"
import type { ListEditorView } from "../../composites/ListEditor"
import { SettingsBlockBase, type LaneView, type PendingView, type SettingsGroupView, type SettingsView, type TierView } from "./component"

interface Group {
    readonly id: string
    readonly label: string
    readonly description: string
    readonly entries: readonly ConfigEntry[]
}

/** What every view builder needs: the value on screen (draft or saved), and the error under a key. */
interface Draft {
    readonly valueOf: (key: string) => unknown
    readonly errorOf: (key: string) => string | null
    readonly jsonTextOf: (key: string) => string | undefined
}

const fileBase = (file: string) => file.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "")

/** routing splits into Models and Song song; liveness reads as Stall; every other file is its own tab. */
const groupIdOf = (entry: ConfigEntry) => {
    const base = fileBase(entry.file)
    if (base === "routing") return /parallel/i.test(entry.key) ? "parallel" : "models"
    if (base === "liveness") return "stall"
    return base
}

const groupEntries = (entries: readonly ConfigEntry[]): readonly Group[] => {
    const byId = new Map<string, ConfigEntry[]>()
    for (const entry of entries) {
        const id = groupIdOf(entry)
        byId.set(id, [...(byId.get(id) ?? []), entry])
    }
    const known = CONFIG_GROUPS.filter((group) => byId.has(group.id))
    const extra = [...byId.keys()].filter((id) => !CONFIG_GROUPS.some((group) => group.id === id)).map((id) => ({ id, label: id, description: "" }))
    return [...known, ...extra].map((group) => ({ ...group, entries: byId.get(group.id) ?? [] }))
}

const TIER_KEY = /^routing\.tiers\.([^.]+)\.(members|effort)$/

const isStringList = (value: unknown): value is readonly string[] => Array.isArray(value) && value.every((item) => typeof item === "string")

/** Distinct values in first-seen order. */
const unique = (lists: readonly (readonly string[])[]): readonly string[] => [...new Set(lists.flat())]

/** Tier ids in the house order (frontier, high, medium, low), then any other tier the config names. */
const tierIds = (entries: readonly ConfigEntry[]): readonly string[] => {
    const found = unique([entries.flatMap((entry) => TIER_KEY.exec(entry.key)?.[1] ?? [])])
    return [...Object.keys(TIER).filter((id) => found.includes(id)), ...found.filter((id) => !(id in TIER))]
}

const isEffortKey = (key: string) => /(^|\.)effort$/i.test(key)
const sameValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

/** A value as the pending list reads it: lists comma-separated, booleans as words. */
const formatValue = (value: unknown): string => {
    if (typeof value === "boolean") return value ? SETTINGS.on : SETTINGS.off
    if (isStringList(value)) return value.length === 0 ? SETTINGS.emptyList : value.join(", ")
    if (typeof value === "string" || typeof value === "number") return String(value)
    return JSON.stringify(value)
}

/** The human name of any key, tier keys included. */
const keyLabel = (key: string): string => {
    const tier = TIER_KEY.exec(key)
    if (tier?.[1] !== undefined) {
        const name = TIER[tier[1]]?.label ?? tier[1]
        return `${name} · ${tier[2] === "members" ? SETTINGS.members : SETTINGS.effort}`
    }
    return configFieldLabel(key).label
}

const listView = (draft: Draft, key: string, view: Omit<ListEditorView, "configKey" | "items" | "error">): ListEditorView => {
    const value = draft.valueOf(key)
    return { ...view, configKey: key, items: isStringList(value) ? value : [], error: draft.errorOf(key) }
}

/** One editor per value type: number field, checkbox, effort select, text field, tag list, and JSON only for the rest. */
const fieldView = (draft: Draft, entry: ConfigEntry, min = 0): ConfigFieldView => {
    const { label, description } = configFieldLabel(entry.key)
    const value = draft.valueOf(entry.key)
    const base = { configKey: entry.key, label, description: description ?? null, error: draft.errorOf(entry.key) }
    if (typeof entry.value === "number") return { ...base, kind: "number", value: typeof value === "number" ? value : entry.value, min }
    if (typeof entry.value === "boolean") return { ...base, kind: "boolean", value: value === true }
    if (typeof entry.value === "string" && isEffortKey(entry.key)) return { ...base, kind: "effort", value: typeof value === "string" ? value : null }
    if (typeof entry.value === "string") return { ...base, kind: "text", value: String(value) }
    if (isStringList(entry.value)) {
        return {
            ...base,
            kind: "list",
            list: listView(draft, entry.key, {
                label,
                pool: null,
                addLabel: SETTINGS.add,
                addPlaceholder: SETTINGS.newItem,
                emptyText: SETTINGS.noItems,
                exhaustedText: SETTINGS.newItem,
                isOrdered: false,
                isAddLabelHidden: false,
            }),
        }
    }
    return { ...base, kind: "json", text: draft.jsonTextOf(entry.key) ?? JSON.stringify(value, null, 2), hint: SETTINGS.jsonHint(entry.key) }
}

const tierName = (tier: string) => TIER[tier]?.label ?? tier

const modelsView = (draft: Draft, group: Group): SettingsGroupView => {
    const keys = new Set(group.entries.map((entry) => entry.key))
    const tiers = tierIds(group.entries)
    const membersOf = (tier: string) => {
        const value = draft.valueOf(`routing.tiers.${tier}.members`)
        return isStringList(value) ? value : []
    }
    // Every model the config knows, saved or drafted, so a removed model can come back.
    const pool = unique([
        ...group.entries.flatMap((entry) => (TIER_KEY.exec(entry.key)?.[2] === "members" && isStringList(entry.value) ? [entry.value] : [])),
        ...tiers.map(membersOf),
    ])
    const tierViews: TierView[] = tiers.map((tier) => {
        const membersKey = `routing.tiers.${tier}.members`
        const effortKey = `routing.tiers.${tier}.effort`
        const effortValue = draft.valueOf(effortKey)
        return {
            id: tier,
            name: tierName(tier),
            description: TIER[tier]?.description ?? null,
            members: keys.has(membersKey)
                ? listView(draft, membersKey, {
                      label: SETTINGS.tierMembers(tierName(tier)),
                      pool,
                      addLabel: SETTINGS.tierAdd(tierName(tier)),
                      addPlaceholder: SETTINGS.addModelPlaceholder,
                      emptyText: SETTINGS.noMembers,
                      exhaustedText: SETTINGS.noMoreModels,
                      isOrdered: true,
                      isAddLabelHidden: true,
                  })
                : null,
            effort: keys.has(effortKey)
                ? {
                      kind: "effort",
                      configKey: effortKey,
                      label: SETTINGS.tierEffort(tierName(tier)),
                      description: null,
                      error: draft.errorOf(effortKey),
                      value: typeof effortValue === "string" ? effortValue : null,
                  }
                : null,
        }
    })
    const rest = group.entries.filter((entry) => !TIER_KEY.test(entry.key))
    return { ...group, kind: "models", tiers: tierViews, lanes: [], fields: rest.map((entry) => fieldView(draft, entry)) }
}

const lanesView = (draft: Draft, group: Group): SettingsGroupView => {
    const lists = group.entries.filter((entry) => isStringList(entry.value))
    const current = (key: string) => {
        const value = draft.valueOf(key)
        return isStringList(value) ? value : []
    }
    const pool = unique([...lists.map((entry) => entry.value as readonly string[]), ...lists.map((entry) => current(entry.key))])
    const lanes: LaneView[] = lists.map((entry) => {
        const { label, description } = configFieldLabel(entry.key)
        return {
            configKey: entry.key,
            title: label,
            description: description ?? null,
            list: listView(draft, entry.key, {
                label: SETTINGS.steps,
                pool,
                addLabel: SETTINGS.addStep,
                addPlaceholder: SETTINGS.addStepPlaceholder,
                emptyText: SETTINGS.noItems,
                exhaustedText: SETTINGS.noMoreSteps,
                isOrdered: true,
                isAddLabelHidden: false,
            }),
        }
    })
    const rest = group.entries.filter((entry) => !isStringList(entry.value))
    return { ...group, kind: "lanes", tiers: [], lanes, fields: rest.map((entry) => fieldView(draft, entry)) }
}

const groupView = (draft: Draft, group: Group): SettingsGroupView => {
    switch (group.id) {
        case "models":
            return modelsView(draft, group)
        case "lanes":
            return lanesView(draft, group)
        case "parallel":
            return { ...group, kind: "parallel", tiers: [], lanes: [], fields: group.entries.map((entry) => fieldView(draft, entry, 1)) }
        default:
            return { ...group, kind: "fields", tiers: [], lanes: [], fields: group.entries.map((entry) => fieldView(draft, entry)) }
    }
}

const without = <T,>(map: ReadonlyMap<string, T>, key: string): ReadonlyMap<string, T> => {
    const next = new Map(map)
    next.delete(key)
    return next
}

const refusalText = (result: ActionResult) => (result.code === null ? result.message : `${result.code}: ${result.message}`)

/** The settings region: every harness value, one tab per concern, saved key by key through `starci config set`. */
export const SettingsBlock = () => {
    const query = useConfigQuery()
    const { send } = useActionCommand()
    const slotLabels = useSlotLabels()
    const entries = useMemo(() => query.data ?? [], [query.data])
    const groups = useMemo(() => groupEntries(entries), [entries])
    const [tab, setTab] = useState<string | null>(null)
    /** Changed values not yet saved, in the order they were first changed. */
    const [drafts, setDrafts] = useState<ReadonlyMap<string, unknown>>(new Map())
    const [jsonTexts, setJsonTexts] = useState<ReadonlyMap<string, string>>(new Map())
    const [jsonErrors, setJsonErrors] = useState<ReadonlyMap<string, string>>(new Map())
    const [refusals, setRefusals] = useState<ReadonlyMap<string, ActionResult>>(new Map())
    const [isSaving, setIsSaving] = useState(false)
    const [summary, setSummary] = useState<{ readonly saved: number; readonly refused: number } | null>(null)

    const originalOf = (key: string) => entries.find((entry) => entry.key === key)?.value
    const draft: Draft = {
        valueOf: (key) => (drafts.has(key) ? drafts.get(key) : originalOf(key)),
        errorOf: (key) => {
            const refusal = refusals.get(key)
            return jsonErrors.get(key) ?? (refusal === undefined ? null : refusalText(refusal))
        },
        jsonTextOf: (key) => jsonTexts.get(key),
    }

    const change = (key: string, value: unknown) => {
        setSummary(null)
        setRefusals((current) => without(current, key))
        setDrafts((current) => (sameValue(value, originalOf(key)) ? without(current, key) : new Map(current).set(key, value)))
    }

    const json = (key: string, text: string) => {
        setJsonTexts((current) => new Map(current).set(key, text))
        try {
            const parsed: unknown = JSON.parse(text)
            setJsonErrors((current) => without(current, key))
            change(key, parsed)
        } catch {
            setJsonErrors((current) => new Map(current).set(key, SETTINGS.jsonInvalid))
        }
    }

    const discard = () => {
        setDrafts(new Map())
        setJsonTexts(new Map())
        setJsonErrors(new Map())
        setRefusals(new Map())
        setSummary(null)
    }

    /** One ConfigSet per key, in the order the keys were changed; a refusal does not stop the ones after it. */
    const save = async () => {
        setIsSaving(true)
        setSummary(null)
        const results = await [...drafts].reduce<Promise<readonly (readonly [string, ActionResult])[]>>(
            (done, [key, value]) => done.then(async (list) => [...list, [key, await send({ kind: "config", set: { key, value } })] as const]),
            Promise.resolve([]),
        )
        const saved = results.filter(([, result]) => result.ok).map(([key]) => key)
        const refused = results.filter(([, result]) => !result.ok)
        setDrafts((current) => saved.reduce(without, current))
        setJsonTexts((current) => saved.reduce(without, current))
        setRefusals(new Map(refused))
        setSummary({ saved: saved.length, refused: refused.length })
        setIsSaving(false)
    }

    const active = groups.find((group) => group.id === tab) ?? groups[0]
    const read = slotOfQuery(query)
    const settings: DataSlot<SettingsView> = {
        ...read,
        items:
            read.items === undefined || active === undefined
                ? undefined
                : { tabs: groups.map((group) => ({ id: group.id, label: group.label })), active: groupView(draft, active) },
    }
    const pending: PendingView[] = [...drafts].map(([key, value]) => ({
        configKey: key,
        label: keyLabel(key),
        before: formatValue(originalOf(key)),
        after: formatValue(value),
        refused: refusals.has(key) ? (refusals.get(key)?.code ?? SETTINGS.refusedBadge) : null,
    }))

    let summaryView: { readonly isOk: boolean; readonly title: string; readonly description: string | null } | null = null
    if (summary !== null && summary.refused === 0) summaryView = { isOk: true, title: SETTINGS.saved(summary.saved), description: null }
    else if (summary !== null) {
        summaryView = {
            isOk: false,
            title: SETTINGS.refusedSummary(summary.refused),
            description: summary.saved === 0 ? SETTINGS.noneWritten : SETTINGS.othersSaved(summary.saved),
        }
    }

    return (
        <SettingsBlockBase
            props={{
                settings,
                pending,
                hasRefusals: refusals.size > 0,
                summary: summaryView,
                isSaving,
                labels: {
                    groups: SETTINGS.groups,
                    scrollPrevious: SETTINGS.scrollPrevious,
                    scrollNext: SETTINGS.scrollNext,
                    tier: SETTINGS.tier,
                    members: SETTINGS.members,
                    effort: SETTINGS.effort,
                    noTiers: SETTINGS.noTiers,
                    pendingList: SETTINGS.pendingList,
                    pendingFact: SETTINGS.pendingFact,
                    pendingActions: SETTINGS.pendingActions,
                    pendingSummary: SETTINGS.pending(drafts.size),
                    refusedHint: SETTINGS.refusedHint,
                    discard: SETTINGS.discard,
                    save: SETTINGS.save,
                    efforts: EFFORT_OPTIONS,
                    words: {
                        add: SETTINGS.add,
                        removeTag: SETTINGS.removeTag,
                        reorderInstructions: SETTINGS.reorderInstructions,
                        reorderAnnouncement: SETTINGS.reorderAnnouncement,
                    },
                    slot: slotLabels(SETTINGS.empty),
                },
            }}
            on={{
                retry: () => void query.refetch(),
                selectTab: setTab,
                change: (key: string, value: ConfigValue) => change(key, value),
                json,
                discard,
                save: () => void save(),
            }}
        />
    )
}
