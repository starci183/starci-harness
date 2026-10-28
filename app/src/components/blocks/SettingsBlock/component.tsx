import {
    Alert,
    Badge,
    Button,
    DataTable,
    DescriptionList,
    Link,
    ListRow,
    PinnedActionBar,
    SurfaceCard,
    SurfaceListCard,
    Tabs,
    Text,
    type DataTableColumn,
} from "@starci/grammar/core"
import type { DataSlot, SlotLabels } from "../../../modules/types"
import { ConfigField, type ConfigFieldView, type ConfigValue, type EffortOption } from "../../composites/ConfigField"
import { ListEditor, type ListEditorView, type ListEditorWords } from "../../composites/ListEditor"
import { SlotView } from "../../composites/SlotView"

/** One routing tier: its members and its effort, each present only when the config names it. */
export interface TierView {
    readonly id: string
    readonly name: string
    readonly description: string | null
    readonly members: ListEditorView | null
    readonly effort: ConfigFieldView | null
}

/** One ordered list of a lane, shown as a row with its editor. */
export interface LaneView {
    readonly configKey: string
    readonly title: string
    readonly description: string | null
    readonly list: ListEditorView
}

/**
 * One tab of settings. `kind` picks the panel that draws it: the tier table, the parallel limits, the lanes' steps, or plain
 * fields; `fields` holds whatever the panel's own editor does not.
 */
export interface SettingsGroupView {
    readonly id: string
    readonly label: string
    readonly description: string
    readonly kind: "models" | "parallel" | "lanes" | "fields"
    readonly tiers: readonly TierView[]
    readonly lanes: readonly LaneView[]
    readonly fields: readonly ConfigFieldView[]
}

/** The tabs and the open group. */
export interface SettingsView {
    readonly tabs: readonly { readonly id: string; readonly label: string }[]
    readonly active: SettingsGroupView
}

/** One unsaved change: old value struck through beside the new one. */
export interface PendingView {
    readonly configKey: string
    readonly label: string
    readonly before: string
    readonly after: string
    /** The refusal code when the last save refused this key. */
    readonly refused: string | null
}

/** Copy the connected block resolves. */
export interface SettingsBlockLabels {
    readonly groups: string
    readonly scrollPrevious: string
    readonly scrollNext: string
    readonly tier: string
    readonly members: string
    readonly effort: string
    readonly noTiers: string
    readonly pendingList: string
    readonly pendingFact: string
    readonly pendingActions: string
    readonly pendingSummary: string
    readonly refusedHint: string
    readonly discard: string
    readonly save: string
    readonly efforts: readonly EffortOption[]
    readonly words: ListEditorWords
    readonly slot: SlotLabels
}

/** Complete input of SettingsBlockBase. */
export interface SettingsBlockBaseProps {
    readonly props: {
        readonly settings: DataSlot<SettingsView>
        readonly pending: readonly PendingView[]
        readonly hasRefusals: boolean
        readonly summary: { readonly isOk: boolean; readonly title: string; readonly description: string | null } | null
        readonly isSaving: boolean
        /** The "Cập nhật app" row: the running version (null when the shell cannot say) and where the latest release is. */
        readonly update: { readonly title: string; readonly version: string | null; readonly linkLabel: string; readonly href: string }
        readonly labels: SettingsBlockLabels
    }
    readonly on: {
        readonly retry: () => void
        readonly selectTab: (id: string) => void
        readonly change: (key: string, value: ConfigValue) => void
        readonly json: (key: string, text: string) => void
        readonly discard: () => void
        readonly save: () => void
    }
}

const placeholderTier = (id: string): TierView => ({ id, name: "", description: null, members: null, effort: null })

/** The first tab the harness opens on is the tier table, so the waiting tree is that table with blank tabs above it. */
const SETTINGS_PLACEHOLDER: SettingsView = {
    tabs: ["t0", "t1", "t2", "t3", "t4"].map((id) => ({ id, label: " " })),
    active: {
        id: "t0",
        label: " ",
        description: " ",
        kind: "models",
        tiers: ["frontier", "high", "medium", "low"].map(placeholderTier),
        lanes: [],
        fields: [],
    },
}

/** Below this width the effort select folds under the tier name, so the members editor keeps its room. */
const TIER_TABLE_COLLAPSE_BELOW = 820

type PanelProps = SettingsBlockBaseProps & { readonly group: SettingsGroupView; readonly isSkeleton: boolean }

const Field = (props: PanelProps & { readonly field: ConfigFieldView; readonly isLabelHidden?: boolean }) => (
    <ConfigField
        field={props.field}
        efforts={props.props.labels.efforts}
        words={props.props.labels.words}
        isDisabled={props.props.isSaving}
        isSkeleton={props.isSkeleton}
        isLabelHidden={props.isLabelHidden === true}
        onChange={props.on.change}
        onJson={props.on.json}
    />
)

const FieldsPanel = (props: PanelProps) =>
    props.group.fields.length === 0 ? null : (
        <SurfaceCard label={props.group.label} headingLevel={2} {...(props.group.description === "" ? {} : { fact: props.group.description })}>
            <div className="app-fields">
                {props.group.fields.map((field) => (
                    <Field key={field.configKey} {...props} field={field} />
                ))}
            </div>
        </SurfaceCard>
    )

const ModelsPanel = (props: PanelProps) => {
    const { labels } = props.props
    const columns: readonly DataTableColumn<TierView>[] = [
        { id: "tier", label: labels.tier, isRowHeader: true },
        {
            id: "members",
            label: labels.members,
            editor: (tier) =>
                tier.members === null ? null : (
                    <ListEditor
                        list={tier.members}
                        words={labels.words}
                        isDisabled={props.props.isSaving}
                        onChange={(items) => props.on.change(tier.members?.configKey ?? "", items)}
                    />
                ),
        },
        {
            id: "effort",
            label: labels.effort,
            priority: "low",
            editor: (tier) => (tier.effort === null ? null : <Field {...props} field={tier.effort} isLabelHidden />),
        },
    ]
    return (
        <div className="app-stack">
            <SurfaceCard label={props.group.label} headingLevel={2} fact={props.group.description}>
                <DataTable<TierView>
                    label={props.group.label}
                    columns={columns}
                    rows={props.group.tiers}
                    collapseBelow={TIER_TABLE_COLLAPSE_BELOW}
                    isLoading={props.isSkeleton}
                    loadingRows={props.group.tiers.length}
                    renderCell={(tier) => (
                        <span className="app-pair">
                            <Text as="span" size="sm" weight="medium">
                                {tier.name}
                            </Text>
                            {tier.description === null ? null : (
                                <Text as="span" size="xs" tone="muted">
                                    {tier.description}
                                </Text>
                            )}
                        </span>
                    )}
                    emptyContent={
                        <Text size="sm" tone="muted">
                            {labels.noTiers}
                        </Text>
                    }
                />
            </SurfaceCard>
            <FieldsPanel {...props} />
        </div>
    )
}

const LanesPanel = (props: PanelProps) => (
    <div className="app-stack">
        <SurfaceListCard label={props.group.label} headingLevel={2} fact={props.group.description}>
            {props.group.lanes.map((lane) => (
                <ListRow key={lane.configKey} title={lane.title} {...(lane.description === null ? {} : { description: lane.description })}>
                    <ListEditor
                        list={lane.list}
                        words={props.props.labels.words}
                        isDisabled={props.props.isSaving}
                        onChange={(items) => props.on.change(lane.configKey, items)}
                    />
                </ListRow>
            ))}
        </SurfaceListCard>
        <FieldsPanel {...props} />
    </div>
)

const GroupPanel = (props: PanelProps) => {
    switch (props.group.kind) {
        case "models":
            return <ModelsPanel {...props} />
        case "lanes":
            return <LanesPanel {...props} />
        case "parallel":
        case "fields":
            return <FieldsPanel {...props} />
    }
}

/** The unsaved changes, old value struck through beside the new one, keys in the monospace stack. */
const PendingChanges = (props: SettingsBlockBaseProps) => {
    const { labels, pending } = props.props
    return (
        <SurfaceCard label={labels.pendingList} headingLevel={2} fact={labels.pendingFact}>
            <div className="app-stack">
                <DescriptionList
                    layout="columns"
                    isDivided
                    items={pending.map((change) => ({
                        id: change.configKey,
                        term: (
                            <span className="app-lines">
                                <span>{change.label}</span>
                                <Text as="span" size="xs" tone="muted" mono>
                                    {change.configKey}
                                </Text>
                            </span>
                        ),
                        description: (
                            <span className="app-row">
                                <Text as="span" size="sm" tone="muted" isSuperseded>
                                    {change.before}
                                </Text>
                                <Text as="span" size="sm" tone="muted">
                                    →
                                </Text>
                                <Text as="span" size="sm" weight="medium">
                                    {change.after}
                                </Text>
                                {change.refused === null ? null : <Badge tone="danger">{change.refused}</Badge>}
                            </span>
                        ),
                    }))}
                />
                {props.props.hasRefusals ? (
                    <Text size="sm" tone="muted">
                        {labels.refusedHint}
                    </Text>
                ) : null}
            </div>
        </SurfaceCard>
    )
}

/** Pure half: the harness's ops/*.yaml values, one tab per concern, with the unsaved changes and the save bar. */
export const SettingsBlockBase = (props: SettingsBlockBaseProps) => {
    const { labels, summary, pending, update } = props.props
    return (
        <div className="app-page-stack">
            <SlotView slot={props.props.settings} placeholder={SETTINGS_PLACEHOLDER} labels={labels.slot} onRetry={props.on.retry}>
                {(settings, isSkeleton) => (
                    <div className="app-stack">
                        {settings.tabs.length === 0 ? null : (
                            <Tabs
                                label={labels.groups}
                                items={[...settings.tabs]}
                                selectedKey={settings.active.id}
                                onSelect={props.on.selectTab}
                                panelId={(id) => `settings-panel-${id}`}
                                labelVisibility="always"
                                scrollPreviousLabel={labels.scrollPrevious}
                                scrollNextLabel={labels.scrollNext}
                            />
                        )}
                        <div role="tabpanel" id={`settings-panel-${settings.active.id}`} aria-label={settings.active.label}>
                            <GroupPanel {...props} group={settings.active} isSkeleton={isSkeleton} />
                        </div>
                    </div>
                )}
            </SlotView>
            <SurfaceCard label={update.title} headingLevel={2}>
                <span className="app-row">
                    {update.version === null ? null : <Text as="span">{update.version}</Text>}
                    <Link href={update.href} kind="external">
                        {update.linkLabel}
                    </Link>
                </span>
            </SurfaceCard>
            {summary === null ? null : (
                <Alert
                    tone={summary.isOk ? "affirmative" : "negative"}
                    title={summary.title}
                    {...(summary.description === null ? {} : { description: summary.description })}
                />
            )}
            {pending.length === 0 ? null : (
                <>
                    <PendingChanges {...props} />
                    <PinnedActionBar
                        label={labels.pendingActions}
                        visibility="always"
                        summary={labels.pendingSummary}
                        dismiss={
                            <Button intent="dismiss" onPress={props.on.discard} isDisabled={props.props.isSaving}>
                                {labels.discard}
                            </Button>
                        }
                        commit={
                            <Button intent="commit" onPress={props.on.save} isPending={props.props.isSaving}>
                                {labels.save}
                            </Button>
                        }
                    />
                </>
            )}
        </div>
    )
}
