import {
    Alert,
    Badge,
    Button,
    DescriptionList,
    ListRow,
    NumberField,
    SectionHeader,
    Select,
    SurfaceCard,
    SurfaceListCard,
    Tabs,
    Text,
} from "@starci/grammar/core"
import { useMemo, useState, type ReactNode } from "react"
import type { ActionResult, ConfigEntry } from "@contract"
import { useAction, useConfig } from "../../api/client"
import { CONFIG_GROUPS, EFFORT_OPTIONS, SETTINGS, TIER, configFieldLabel, type ConfigGroupLabel } from "../../app/labels"
import { FieldEditor, ListEditor, helper, isStringList, unique, type Draft } from "./editors"

interface Group extends ConfigGroupLabel {
    readonly files: readonly string[]
    readonly entries: readonly ConfigEntry[]
}

const fileBase = (file: string) => file.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "")

/** routing splits into Models and Song song; liveness reads as Stall; every other file is its own tab. */
const groupIdOf = (entry: ConfigEntry) => {
    const base = fileBase(entry.file)
    if (base === "routing") return /parallel/i.test(entry.key) ? "parallel" : "models"
    if (base === "liveness") return "stall"
    return base
}

const groupEntries = (entries: readonly ConfigEntry[]): Group[] => {
    const byId = new Map<string, ConfigEntry[]>()
    for (const entry of entries) {
        const id = groupIdOf(entry)
        byId.set(id, [...(byId.get(id) ?? []), entry])
    }
    const known = CONFIG_GROUPS.filter((group) => byId.has(group.id))
    const extra = [...byId.keys()]
        .filter((id) => !CONFIG_GROUPS.some((group) => group.id === id))
        .map((id) => ({ id, label: id, description: "" }))
    return [...known, ...extra].map((group) => {
        const groupEntries = byId.get(group.id) ?? []
        return { ...group, entries: groupEntries, files: [...new Set(groupEntries.map((entry) => entry.file))] }
    })
}

const TIER_KEY = /^routing\.tiers\.([^.]+)\.(members|effort)$/

/** Tier ids in the house order (frontier, high, medium, low), then any other tier the config names. */
const tierIds = (entries: readonly ConfigEntry[]): readonly string[] => {
    const found = unique([entries.flatMap((entry) => TIER_KEY.exec(entry.key)?.[1] ?? [])])
    return [...Object.keys(TIER).filter((id) => found.includes(id)), ...found.filter((id) => !(id in TIER))]
}

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

const ModelsPanel = ({ group, draft }: { readonly group: Group; readonly draft: Draft }) => {
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
    const rest = group.entries.filter((entry) => !TIER_KEY.test(entry.key))
    return (
        <div className="app-stack">
            <SurfaceListCard label={group.label} headingLevel={2} fact={group.description}>
                {tiers.map((tier) => {
                    const membersKey = `routing.tiers.${tier}.members`
                    const effortKey = `routing.tiers.${tier}.effort`
                    const effort = draft.valueOf(effortKey)
                    const effortError = draft.errorOf(effortKey)
                    const effortSelect = keys.has(effortKey) ? (
                        <Select
                            label={SETTINGS.effort}
                            options={EFFORT_OPTIONS}
                            value={typeof effort === "string" ? effort : null}
                            onValueChange={(next) => {
                                if (next !== null) draft.set(effortKey, next)
                            }}
                            description={effortKey}
                            isDisabled={draft.isDisabled}
                            {...(effortError === undefined ? {} : { errorMessage: effortError })}
                        />
                    ) : null
                    return (
                        <ListRow key={tier} title={TIER[tier]?.label ?? tier} description={TIER[tier]?.description}>
                            {keys.has(membersKey) ? (
                                <ListEditor
                                    configKey={membersKey}
                                    label={SETTINGS.members}
                                    items={membersOf(tier)}
                                    pool={pool}
                                    addLabel={SETTINGS.addModel}
                                    addPlaceholder={SETTINGS.addModelPlaceholder}
                                    emptyText={SETTINGS.noMembers}
                                    exhaustedText={SETTINGS.noMoreModels}
                                    aside={effortSelect}
                                    draft={draft}
                                />
                            ) : (
                                effortSelect
                            )}
                        </ListRow>
                    )
                })}
            </SurfaceListCard>
            {rest.length === 0 ? null : <FieldsPanel group={{ ...group, entries: rest }} draft={draft} />}
        </div>
    )
}

const ParallelPanel = ({ group, draft }: { readonly group: Group; readonly draft: Draft }) => (
    <SurfaceCard label={group.label} headingLevel={2} fact={group.description}>
        <div className="app-fields">
            {group.entries.map((entry) => {
                if (typeof entry.value !== "number") return <FieldEditor key={entry.key} entry={entry} draft={draft} />
                const { label, description } = configFieldLabel(entry.key)
                const value = draft.valueOf(entry.key)
                const error = draft.errorOf(entry.key)
                return (
                    <NumberField
                        key={entry.key}
                        label={label}
                        description={helper(entry.key, description)}
                        minValue={1}
                        value={typeof value === "number" ? value : entry.value}
                        onValueChange={(next) => {
                            if (!Number.isNaN(next)) draft.set(entry.key, next)
                        }}
                        isDisabled={draft.isDisabled}
                        {...(error === undefined ? {} : { errorMessage: error })}
                    />
                )
            })}
        </div>
    </SurfaceCard>
)

const LanesPanel = ({ group, draft }: { readonly group: Group; readonly draft: Draft }) => {
    const lists = group.entries.filter((entry) => isStringList(entry.value))
    const rest = group.entries.filter((entry) => !isStringList(entry.value))
    const current = (key: string) => {
        const value = draft.valueOf(key)
        return isStringList(value) ? value : []
    }
    const pool = unique([...lists.map((entry) => entry.value as readonly string[]), ...lists.map((entry) => current(entry.key))])
    return (
        <div className="app-stack">
            <SurfaceListCard label={group.label} headingLevel={2} fact={group.description}>
                {lists.map((entry) => {
                    const { label, description } = configFieldLabel(entry.key)
                    return (
                        <ListRow key={entry.key} title={label} description={description}>
                            <ListEditor
                                configKey={entry.key}
                                label={SETTINGS.steps}
                                items={current(entry.key)}
                                pool={pool}
                                addLabel={SETTINGS.addStep}
                                addPlaceholder={SETTINGS.addStepPlaceholder}
                                emptyText={SETTINGS.noItems}
                                exhaustedText={SETTINGS.noMoreSteps}
                                draft={draft}
                            />
                        </ListRow>
                    )
                })}
            </SurfaceListCard>
            {rest.length === 0 ? null : <FieldsPanel group={{ ...group, entries: rest }} draft={draft} />}
        </div>
    )
}

const FieldsPanel = ({ group, draft }: { readonly group: Group; readonly draft: Draft }) => (
    <SurfaceCard label={group.label} headingLevel={2} {...(group.description === "" ? {} : { fact: group.description })}>
        <div className="app-fields">
            {group.entries.map((entry) => (
                <FieldEditor key={entry.key} entry={entry} draft={draft} />
            ))}
        </div>
    </SurfaceCard>
)

const GroupPanel = ({ group, draft }: { readonly group: Group; readonly draft: Draft }) => {
    switch (group.id) {
        case "models":
            return <ModelsPanel group={group} draft={draft} />
        case "parallel":
            return <ParallelPanel group={group} draft={draft} />
        case "lanes":
            return <LanesPanel group={group} draft={draft} />
        default:
            return <FieldsPanel group={group} draft={draft} />
    }
}

const LoadingGroup = () => (
    <SurfaceCard ariaLabel={SETTINGS.loading}>
        <div className="app-fields">
            <NumberField label={SETTINGS.loading} isSkeleton />
            <NumberField label={SETTINGS.loading} isSkeleton />
            <NumberField label={SETTINGS.loading} isSkeleton />
            <NumberField label={SETTINGS.loading} isSkeleton />
        </div>
    </SurfaceCard>
)

interface PendingProps {
    readonly drafts: ReadonlyMap<string, unknown>
    readonly originalOf: (key: string) => unknown
    readonly refusals: ReadonlyMap<string, ActionResult>
    readonly isSaving: boolean
    readonly onDiscard: () => void
    readonly onSave: () => void
}

/** The unsaved changes, old value struck through beside the new one, with the two commands that settle them. */
const PendingChanges = ({ drafts, originalOf, refusals, isSaving, onDiscard, onSave }: PendingProps) => (
    <div className="app-sticky-end">
        <SurfaceCard label={SETTINGS.pending(drafts.size)} headingLevel={2} fact={SETTINGS.pendingFact}>
            <div className="app-stack">
                <DescriptionList
                    layout="columns"
                    isDivided
                    items={[...drafts].map(([key, value]) => {
                        const refusal = refusals.get(key)
                        return {
                            id: key,
                            term: (
                                <span className="app-lines">
                                    <span>{keyLabel(key)}</span>
                                    <Text as="span" size="xs" tone="muted">
                                        {key}
                                    </Text>
                                </span>
                            ),
                            description: (
                                <span className="app-row">
                                    <Text as="span" size="sm" tone="muted" isSuperseded>
                                        {formatValue(originalOf(key))}
                                    </Text>
                                    <Text as="span" size="sm" tone="muted">
                                        →
                                    </Text>
                                    <Text as="span" size="sm" weight="medium">
                                        {formatValue(value)}
                                    </Text>
                                    {refusal === undefined ? null : <Badge tone="danger">{refusal.code ?? SETTINGS.refusedBadge}</Badge>}
                                </span>
                            ),
                        }
                    })}
                />
                {refusals.size === 0 ? null : (
                    <Text size="sm" tone="muted">
                        {SETTINGS.refusedHint}
                    </Text>
                )}
                <div className="app-row app-row-end">
                    <Button intent="dismiss" onPress={onDiscard} isDisabled={isSaving}>
                        {SETTINGS.discard}
                    </Button>
                    <Button intent="commit" onPress={onSave} isPending={isSaving}>
                        {SETTINGS.save}
                    </Button>
                </div>
            </div>
        </SurfaceCard>
    </div>
)

/** Route `/settings` · Cài đặt: the harness's ops/*.yaml values, one tab per concern, saved through starci config set. */
export const SettingsPage = () => {
    const { data, isLoading, error } = useConfig()
    const { mutateAsync } = useAction()
    const entries = useMemo(() => data ?? [], [data])
    const groups = useMemo(() => groupEntries(entries), [entries])
    const [tab, setTab] = useState<string | null>(null)
    /** Changed values not yet saved, in the order they were first changed. */
    const [drafts, setDrafts] = useState<ReadonlyMap<string, unknown>>(new Map())
    const [jsonTexts, setJsonTexts] = useState<ReadonlyMap<string, string>>(new Map())
    const [jsonErrors, setJsonErrors] = useState<ReadonlyMap<string, string>>(new Map())
    const [refusals, setRefusals] = useState<ReadonlyMap<string, ActionResult>>(new Map())
    const [isSaving, setIsSaving] = useState(false)
    const [summary, setSummary] = useState<{ readonly saved: number; readonly refused: number } | null>(null)

    const activeGroup = groups.find((group) => group.id === tab) ?? groups[0]
    const originalOf = (key: string) => entries.find((entry) => entry.key === key)?.value

    const without = <T,>(map: ReadonlyMap<string, T>, key: string) => {
        const next = new Map(map)
        next.delete(key)
        return next
    }

    const set = (key: string, value: unknown) => {
        setSummary(null)
        setRefusals((current) => without(current, key))
        setDrafts((current) => (sameValue(value, originalOf(key)) ? without(current, key) : new Map(current).set(key, value)))
    }

    const refusalText = (result: ActionResult) => (result.code === null ? result.message : `${result.code}: ${result.message}`)

    const draft: Draft = {
        valueOf: (key) => (drafts.has(key) ? drafts.get(key) : originalOf(key)),
        errorOf: (key) => {
            const refusal = refusals.get(key)
            return jsonErrors.get(key) ?? (refusal === undefined ? undefined : refusalText(refusal))
        },
        jsonTextOf: (key) => jsonTexts.get(key),
        set,
        setJson: (key, text) => {
            setJsonTexts((current) => new Map(current).set(key, text))
            try {
                const parsed: unknown = JSON.parse(text)
                setJsonErrors((current) => without(current, key))
                set(key, parsed)
            } catch {
                setJsonErrors((current) => new Map(current).set(key, SETTINGS.jsonInvalid))
            }
        },
        isDisabled: isSaving,
    }

    const discard = () => {
        setDrafts(new Map())
        setJsonTexts(new Map())
        setJsonErrors(new Map())
        setRefusals(new Map())
        setSummary(null)
    }

    const save = async () => {
        setIsSaving(true)
        setSummary(null)
        let saved = 0
        let refused = 0
        // One ConfigSet per key, in the order the keys were changed; a refusal does not stop the ones after it.
        for (const [key, value] of drafts) {
            let result: ActionResult
            try {
                result = await mutateAsync({ kind: "config", set: { key, value } })
            } catch (cause) {
                result = { ok: false, code: null, message: cause instanceof Error ? cause.message : String(cause) }
            }
            if (result.ok) {
                saved += 1
                setDrafts((current) => without(current, key))
                setJsonTexts((current) => without(current, key))
                setRefusals((current) => without(current, key))
            } else {
                refused += 1
                setRefusals((current) => new Map(current).set(key, result))
            }
        }
        setSummary({ saved, refused })
        setIsSaving(false)
    }

    let body: ReactNode
    if (isLoading) body = <LoadingGroup />
    else if (error !== null) body = <Alert tone="negative" title={SETTINGS.loadError} description={error.message} />
    else if (activeGroup === undefined) body = <Alert tone="informative" title={SETTINGS.empty} />
    else
        body = (
            <div role="tabpanel" id={`settings-panel-${activeGroup.id}`} aria-label={activeGroup.label}>
                <GroupPanel group={activeGroup} draft={draft} />
            </div>
        )

    return (
        <div className="app-page-stack">
            <SectionHeader level={1} title={SETTINGS.title} description={SETTINGS.description} />
            <div className="app-stack">
                {groups.length > 0 ? (
                    <Tabs
                        label={SETTINGS.groups}
                        items={groups.map((group) => ({ id: group.id, label: group.label }))}
                        selectedKey={activeGroup?.id ?? ""}
                        onSelect={setTab}
                        panelId={(id) => `settings-panel-${id}`}
                        labelVisibility="always"
                        scrollPreviousLabel={SETTINGS.scrollPrevious}
                        scrollNextLabel={SETTINGS.scrollNext}
                    />
                ) : null}
                {body}
            </div>
            {summary === null ? null : summary.refused === 0 ? (
                <Alert tone="affirmative" title={SETTINGS.saved(summary.saved)} />
            ) : (
                <Alert
                    tone="negative"
                    title={SETTINGS.refusedSummary(summary.refused)}
                    description={summary.saved === 0 ? SETTINGS.noneWritten : SETTINGS.othersSaved(summary.saved)}
                />
            )}
            {drafts.size === 0 ? null : (
                <PendingChanges
                    drafts={drafts}
                    originalOf={originalOf}
                    refusals={refusals}
                    isSaving={isSaving}
                    onDiscard={discard}
                    onSave={() => void save()}
                />
            )}
        </div>
    )
}
