import { Badge, Button, Code, ListRow, Select, SurfaceCard, SurfaceListCard, Text, Textarea } from "@starci/grammar/core"
import type { DataSlot, SlotLabels, ToneLabel } from "../../../modules/types"
import { SlotView } from "../../composites/SlotView"

/** One request handed to a Supervisor, resolved for drawing. */
export interface OwnerRequestItemView {
    readonly id: string
    readonly project: string
    readonly text: string
    readonly status: ToneLabel
}

/** One project the composer can address. */
export interface ProjectOptionView {
    readonly value: string
    readonly label: string
}

/** Copy the connected block resolves. */
export interface OwnerRequestBlockLabels {
    readonly card: string
    readonly project: string
    readonly projectPlaceholder: string
    readonly text: string
    readonly textHint: string
    readonly send: string
    readonly commandPrefix: string
    readonly command: string
    readonly commandSuffix: string
    readonly list: string
    readonly projectsSlot: SlotLabels
    readonly requestsSlot: SlotLabels
}

/** Complete input of OwnerRequestBlockBase. */
export interface OwnerRequestBlockBaseProps {
    readonly props: {
        readonly projects: DataSlot<readonly ProjectOptionView[]>
        readonly requests: DataSlot<readonly OwnerRequestItemView[]>
        readonly project: string | null
        readonly text: string
        readonly canSend: boolean
        readonly isPending: boolean
        readonly labels: OwnerRequestBlockLabels
    }
    readonly on: {
        readonly retryProjects: () => void
        readonly retryRequests: () => void
        readonly setProject: (project: string | null) => void
        readonly setText: (text: string) => void
        readonly send: () => void
    }
}

const PROJECTS_PLACEHOLDER: readonly ProjectOptionView[] = [{ value: "p0", label: " " }]

const REQUESTS_PLACEHOLDER: readonly OwnerRequestItemView[] = ["r0", "r1"].map((id) => ({
    id,
    project: "",
    text: "",
    status: { label: "", tone: "neutral" },
}))

/** Pure half: the composer that hands a project's Supervisor a request, and the requests already handed over. */
export const OwnerRequestBlockBase = (props: OwnerRequestBlockBaseProps) => {
    const { labels, isPending } = props.props
    return (
        <div className="app-stack">
            <SurfaceCard label={labels.card} headingLevel={2}>
                <SlotView slot={props.props.projects} placeholder={PROJECTS_PLACEHOLDER} labels={labels.projectsSlot} onRetry={props.on.retryProjects}>
                    {(projects, isSkeleton) => (
                        <div className="app-stack">
                            <Select
                                label={labels.project}
                                placeholder={labels.projectPlaceholder}
                                options={projects.map((project) => ({ id: project.value, label: project.label }))}
                                value={props.props.project}
                                onValueChange={props.on.setProject}
                                isDisabled={isPending}
                                isSkeleton={isSkeleton}
                            />
                            <Textarea
                                label={labels.text}
                                description={labels.textHint}
                                rows={3}
                                value={props.props.text}
                                onValueChange={props.on.setText}
                                isDisabled={isPending}
                                isSkeleton={isSkeleton}
                            />
                            <div className="app-pair">
                                <span className="app-row">
                                    <Button intent="commit" onPress={props.on.send} isDisabled={!props.props.canSend} isPending={isPending} isSkeleton={isSkeleton}>
                                        {labels.send}
                                    </Button>
                                </span>
                                <Text size="xs" tone="muted" isSkeleton={isSkeleton}>
                                    {labels.commandPrefix} <Code>{labels.command}</Code> {labels.commandSuffix}
                                </Text>
                            </div>
                        </div>
                    )}
                </SlotView>
            </SurfaceCard>
            <SurfaceListCard label={labels.list} headingLevel={2}>
                <SlotView slot={props.props.requests} placeholder={REQUESTS_PLACEHOLDER} labels={labels.requestsSlot} onRetry={props.on.retryRequests}>
                    {(requests, isSkeleton) =>
                        requests.map((request) => (
                            <ListRow
                                key={request.id}
                                title={request.text}
                                description={
                                    <span className="app-row">
                                        <Code>{request.id}</Code>
                                        <span>{request.project}</span>
                                    </span>
                                }
                                badges={
                                    <Badge tone={request.status.tone} isSkeleton={isSkeleton}>
                                        {request.status.label}
                                    </Badge>
                                }
                                isSkeleton={isSkeleton}
                            />
                        ))
                    }
                </SlotView>
            </SurfaceListCard>
        </div>
    )
}
