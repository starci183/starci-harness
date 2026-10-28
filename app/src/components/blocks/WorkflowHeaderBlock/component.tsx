import { Alert, AlertDialog, Button, Dialog, PageContainer, PageHeader, RadioGroup, Textarea } from "@starci/grammar/core"
import type { DataSlot, ResultNotice, SlotLabels, ToneLabel } from "../../../modules/types"
import { SlotView } from "../../composites/SlotView"
import { StatusWord } from "../../leaves/StatusWord"

/**
 * The drawn shapes of a workflow's header: `running` offers pause, `paused` offers resume, and `stopped` (stopping, stopped
 * or done) offers nothing but the record.
 */
export type WorkflowHeaderShape = "running" | "paused" | "stopped"

/** The header facts, resolved for drawing. */
export interface WorkflowHeaderView {
    readonly title: string
    readonly status: ToneLabel
    readonly versions: string
    readonly goal: string
    readonly reason: string | null
}

export type StopMode = "stop-graceful" | "stop-hard"

/** Copy the connected header resolves. */
export interface WorkflowHeaderBlockLabels {
    readonly trail: { readonly label: string; readonly project: string; readonly workflows: string }
    readonly reason: string
    readonly changeGoal: string
    readonly changeGoalHint: string
    readonly goalField: string
    readonly saveGoal: string
    readonly pause: string
    readonly resume: string
    readonly stop: string
    readonly stopTitle: string
    readonly stopBody: string
    readonly stopConfirm: string
    readonly stopMode: string
    readonly stopGraceful: string
    readonly stopGracefulHint: string
    readonly stopHard: string
    readonly stopHardHint: string
    readonly close: string
    readonly cancel: string
    readonly dismiss: string
    readonly slot: SlotLabels
}

/** Complete input of WorkflowHeaderBlockBase. */
export interface WorkflowHeaderBlockBaseProps {
    readonly shape: WorkflowHeaderShape
    readonly props: {
        readonly header: DataSlot<WorkflowHeaderView>
        readonly overviewHref: string
        readonly goalDraft: string
        readonly canSaveGoal: boolean
        readonly stopMode: StopMode
        readonly isPending: boolean
        readonly result: ResultNotice | null
        readonly labels: WorkflowHeaderBlockLabels
    }
    readonly on: {
        readonly retry: () => void
        readonly setGoal: (text: string) => void
        /** Resolves true when the server took the new goal, so the dialog closes. */
        readonly saveGoal: () => Promise<boolean>
        readonly toggle: () => void
        readonly setStopMode: (mode: StopMode) => void
        /** Resolves null when the server took the stop, else the refusal to show in the dialog. */
        readonly stop: () => Promise<string | null>
    }
}

const HEADER_PLACEHOLDER: WorkflowHeaderView = {
    title: " ",
    status: { label: " ", tone: "neutral" },
    versions: "",
    goal: "",
    reason: null,
}

/** Change goal, pause or resume, and stop; what each offers follows the shape. */
const WorkflowActions = (props: WorkflowHeaderBlockBaseProps) => {
    const { labels } = props.props
    const isStopped = props.shape === "stopped"
    let toggle: { readonly label: string; readonly isDisabled: boolean }
    switch (props.shape) {
        case "running":
            toggle = { label: labels.pause, isDisabled: false }
            break
        case "paused":
            toggle = { label: labels.resume, isDisabled: false }
            break
        case "stopped":
            toggle = { label: labels.pause, isDisabled: true }
            break
    }
    return (
        <span className="app-row">
            <Dialog
                title={labels.changeGoal}
                description={labels.changeGoalHint}
                closeLabel={labels.close}
                trigger={
                    <Button intent="neutral" isDisabled={isStopped}>
                        {labels.changeGoal}
                    </Button>
                }
                footer={(close) => (
                    <Button
                        intent="commit"
                        isPending={props.props.isPending}
                        isDisabled={!props.props.canSaveGoal}
                        onPress={() => {
                            void props.on.saveGoal().then((isSaved) => {
                                if (isSaved) close()
                            })
                        }}
                    >
                        {labels.saveGoal}
                    </Button>
                )}
            >
                <Textarea label={labels.goalField} rows={5} value={props.props.goalDraft} onValueChange={props.on.setGoal} isRequired />
            </Dialog>
            <Button
                intent="neutral"
                isPending={props.props.isPending}
                isDisabled={toggle.isDisabled}
                onPress={props.on.toggle}
            >
                {toggle.label}
            </Button>
            <AlertDialog
                title={labels.stopTitle}
                description={labels.stopBody}
                confirmLabel={labels.stopConfirm}
                cancelLabel={labels.cancel}
                trigger={
                    <Button intent="destructive" step="entry" isDisabled={isStopped}>
                        {labels.stop}
                    </Button>
                }
                onConfirm={async () => {
                    const refusal = await props.on.stop()
                    if (refusal !== null) throw new Error(refusal)
                }}
            >
                <RadioGroup
                    label={labels.stopMode}
                    value={props.props.stopMode}
                    onValueChange={(value) => props.on.setStopMode(value === "stop-hard" ? "stop-hard" : "stop-graceful")}
                    options={[
                        { value: "stop-graceful", label: labels.stopGraceful, description: labels.stopGracefulHint },
                        { value: "stop-hard", label: labels.stopHard, description: labels.stopHardHint },
                    ]}
                />
            </AlertDialog>
        </span>
    )
}

/**
 * Pure half: the page header (where the workflow sits, its title, status and versions, its goal and the owner's verbs), then
 * the reason it is held and the last verb's outcome in the page's gutter.
 */
export const WorkflowHeaderBlockBase = (props: WorkflowHeaderBlockBaseProps) => {
    const { labels, result } = props.props
    return (
        <>
            <SlotView slot={props.props.header} placeholder={HEADER_PLACEHOLDER} labels={labels.slot} isFramed onRetry={props.on.retry}>
                {(header, isSkeleton) => (
                    <>
                        <PageHeader
                            measure="full"
                            isSkeleton={isSkeleton}
                            breadcrumbs={{
                                label: labels.trail.label,
                                items: [
                                    { id: "project", label: labels.trail.project, href: props.props.overviewHref },
                                    { id: "workflows", label: labels.trail.workflows },
                                ],
                            }}
                            title={header.title}
                            status={<StatusWord status={header.status} />}
                            meta={header.versions}
                            description={header.goal}
                            actions={<WorkflowActions {...props} />}
                        />
                        {header.reason === null ? null : (
                            <PageContainer measure="full" className="app-page-notices">
                                <Alert tone="cautionary" title={labels.reason} description={header.reason} />
                            </PageContainer>
                        )}
                    </>
                )}
            </SlotView>
            {result === null ? null : (
                <PageContainer measure="full" className="app-page-notices">
                    <Alert
                        key={result.n}
                        tone={result.isOk ? "affirmative" : "negative"}
                        title={result.title}
                        description={result.description}
                        dismissLabel={labels.dismiss}
                    />
                </PageContainer>
            )}
        </>
    )
}
