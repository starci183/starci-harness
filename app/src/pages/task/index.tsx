import {
    Alert,
    Badge,
    Breadcrumbs,
    DataTable,
    DescriptionList,
    EmptyNotice,
    FencedCodeBlock,
    PrimaryRailLayout,
    SectionHeader,
    SurfaceCard,
    TagGroup,
    Text,
    Timeline,
    VerticalScrollRegion,
    type DataTableColumn,
    type PresentationState,
} from "@starci/grammar/core"
import { CommandLineIcon } from "@heroicons/react/24/outline"
import { useEffect, useRef } from "react"
import { useParams } from "react-router"
import { useTask } from "../../api/client"
import type { Check, TaskDetail } from "@contract"
import { CHECK_STATE, COMMON, LOCALE, NAV, NODE_STATE, TASK } from "../../app/labels"
import { elapsedText, memberText, workflowPath } from "../workflow/state"

const CHECK_COLUMNS: readonly DataTableColumn[] = [
    { id: "name", label: TASK.checkColumns.name, isRowHeader: true },
    { id: "tier", label: TASK.checkColumns.tier },
    { id: "state", label: TASK.checkColumns.state },
    { id: "detail", label: TASK.checkColumns.detail },
]

type CheckRow = Check & { readonly id: string }

const attemptTime = new Intl.DateTimeFormat(LOCALE, { dateStyle: "short", timeStyle: "short" })

/** Route `/t/:project/:task`: one Op's contract, checks, live terminal tail, route explanation and attempts. */
export const TaskPage = () => {
    const params = useParams()
    const project = params["project"] ?? ""
    const id = params["task"] ?? ""
    const { data, isLoading, error } = useTask(project, id)

    if (error !== null) {
        return (
            <div className="app-page-stack">
                <SectionHeader level={1} title={TASK.fallbackTitle(id)} />
                <Alert tone="negative" title={TASK.loadError} description={error.message} />
            </div>
        )
    }
    if (isLoading) {
        return (
            <div className="app-page-stack" aria-busy="true">
                <SectionHeader level={1} title={TASK.fallbackTitle(id)} description={COMMON.dash} isSkeleton />
                <SurfaceCard label={TASK.contract} headingLevel={2}>
                    <DescriptionList
                        isLoading
                        items={[
                            { id: "summary", term: TASK.summary, description: "" },
                            { id: "deps", term: TASK.deps, description: "" },
                        ]}
                    />
                </SurfaceCard>
            </div>
        )
    }
    if (data === undefined) {
        return (
            <div className="app-page-stack">
                <SectionHeader level={1} title={TASK.fallbackTitle(id)} />
                <EmptyNotice iconSource={CommandLineIcon} message={TASK.notFound} description={TASK.notFoundHint(project, id)} />
            </div>
        )
    }
    return <TaskView task={data} />
}

const outcomeState = (outcome: string): PresentationState => {
    if (outcome === "running" || outcome === "verifying") return "informative"
    if (outcome === "done" || outcome === "accepted" || outcome === "green") return "affirmative"
    if (outcome === "failed" || outcome === "refused" || outcome === "lost" || outcome === "red") return "negative"
    if (outcome === "returned" || outcome === "blocked") return "cautionary"
    return "neutral"
}

/** An attempt outcome is a node state word when it names one; otherwise the server's own word. */
const outcomeLabel = (outcome: string): string => (outcome in NODE_STATE ? NODE_STATE[outcome as keyof typeof NODE_STATE].label : outcome)

const TaskView = ({ task }: { readonly task: TaskDetail }) => {
    const state = NODE_STATE[task.state]
    const latest = task.attempts.at(-1)
    const isLive = task.state === "running" || task.state === "verifying"
    const backHref = workflowPath(task.project, task.workflow)

    return (
        <div className="app-page-stack">
            <div className="app-pair">
                <Breadcrumbs
                    label={TASK.breadcrumbs}
                    items={[
                        { id: "overview", label: NAV.overview, href: "/" },
                        { id: "workflow", label: task.workflow, href: backHref },
                        { id: "task", label: task.id },
                    ]}
                />
                <SectionHeader
                    level={1}
                    title={TASK.title(task.label, task.title)}
                    description={
                        <span className="app-row">
                            <Badge tone={state.tone} isDot>
                                {state.label}
                            </Badge>
                            <Text as="span" size="sm" tone="muted">
                                {isLive && latest !== undefined ? `${task.id} · ${elapsedText(latest.at)}` : task.id}
                            </Text>
                        </span>
                    }
                />
            </div>
            <PrimaryRailLayout
                railWidth="wide"
                primary={
                    <div className="app-stack">
                        <ContractPanel task={task} />
                        <ChecksPanel task={task} />
                        <TerminalPanel task={task} />
                    </div>
                }
                rail={
                    <div className="app-stack">
                        <RoutePanel task={task} />
                        <AttemptsPanel task={task} />
                    </div>
                }
            />
        </div>
    )
}

const ContractPanel = ({ task }: { readonly task: TaskDetail }) => (
    <SurfaceCard label={TASK.contract} headingLevel={2}>
        <div className="app-stack">
            <Text>{task.contract.summary}</Text>
            <TagGroup
                label={TASK.allowPaths}
                size="sm"
                items={task.contract.allowPaths.map((path) => ({ id: path, label: path }))}
                emptyContent={
                    <Text size="sm" tone="muted">
                        {TASK.anyPath}
                    </Text>
                }
            />
            <DescriptionList
                isDivided
                items={[
                    { id: "deps", term: TASK.deps, description: task.contract.dependsOn.length === 0 ? COMMON.none : task.contract.dependsOn.join(", ") },
                    { id: "record", term: TASK.record, description: task.contract.record ?? COMMON.none },
                    { id: "step", term: TASK.step, description: task.contract.step ?? COMMON.none },
                ]}
            />
        </div>
    </SurfaceCard>
)

const ChecksPanel = ({ task }: { readonly task: TaskDetail }) => {
    const rows: CheckRow[] = task.checks.map((check, index) => ({ ...check, id: `${index}-${check.name}` }))
    return (
        <SurfaceCard label={TASK.checks} headingLevel={2}>
            <DataTable<CheckRow>
                label={TASK.checksTable}
                columns={CHECK_COLUMNS}
                rows={rows}
                emptyContent={
                    <Text size="sm" tone="muted">
                        {TASK.noChecks}
                    </Text>
                }
                renderCell={(row, columnId) => {
                    if (columnId === "name") return <Text size="sm">{row.name}</Text>
                    if (columnId === "tier") return <Badge tone="neutral">{row.tier}</Badge>
                    if (columnId === "state") {
                        const check = CHECK_STATE[row.state]
                        return (
                            <Badge tone={check.tone} isDot>
                                {check.label}
                            </Badge>
                        )
                    }
                    return (
                        <Text size="sm" tone="muted">
                            {row.detail ?? COMMON.dash}
                        </Text>
                    )
                }}
            />
        </SurfaceCard>
    )
}

const TerminalPanel = ({ task }: { readonly task: TaskDetail }) => {
    const scroller = useRef<HTMLDivElement>(null)
    const tail = task.terminalTail.join("\n")
    useEffect(() => {
        const element = scroller.current
        if (element !== null) element.scrollTop = element.scrollHeight
    }, [tail])
    const latest = task.attempts.at(-1)
    const fact = [latest === undefined ? null : memberText(latest.member), task.terminal].filter((part) => part !== null).join(" · ")

    return (
        <SurfaceCard label={TASK.terminal} headingLevel={2} {...(fact === "" ? {} : { fact })}>
            {task.terminalTail.length === 0 ? (
                <Text size="sm" tone="muted">
                    {TASK.noTerminal}
                </Text>
            ) : (
                <VerticalScrollRegion ref={scroller} className="app-terminal" isScrollable aria-label={TASK.terminalTail} hideScrollBar={false}>
                    <FencedCodeBlock label={TASK.terminalTail} code={tail} />
                </VerticalScrollRegion>
            )}
        </SurfaceCard>
    )
}

const RoutePanel = ({ task }: { readonly task: TaskDetail }) => (
    <SurfaceCard label={TASK.route} headingLevel={2} fact={TASK.routeFact(task.route.tier)}>
        <div className="app-stack">
            <Timeline
                label={TASK.routeSteps}
                items={task.route.steps.map((step, index) => ({ id: `${index}-${step.step}`, title: step.step, description: step.detail }))}
            />
            <SurfaceCard label={TASK.chosen} headingLevel={3} state="informative">
                <DescriptionList
                    layout="stacked"
                    isDivided
                    items={[
                        { id: "model", term: TASK.model, description: `${task.route.chosen.agent} · ${task.route.chosen.model}` },
                        { id: "effort", term: TASK.effort, description: task.route.chosen.effort ?? COMMON.defaultEffort },
                        { id: "by", term: TASK.by, description: task.route.by },
                    ]}
                />
            </SurfaceCard>
        </div>
    </SurfaceCard>
)

const AttemptsPanel = ({ task }: { readonly task: TaskDetail }) => (
    <SurfaceCard label={TASK.attempts(task.attempts.length)} headingLevel={2}>
        {task.attempts.length === 0 ? (
            <Text size="sm" tone="muted">
                {TASK.noAttempts}
            </Text>
        ) : (
            <Timeline
                label={TASK.attemptsList}
                items={[...task.attempts].reverse().map((attempt, index) => ({
                    id: String(attempt.n),
                    title: `#${attempt.n} · ${attempt.member.model}`,
                    description: outcomeLabel(attempt.outcome),
                    dateTime: attempt.at,
                    timeLabel: attemptTime.format(new Date(attempt.at)),
                    state: outcomeState(attempt.outcome),
                    isCurrent: index === 0,
                }))}
            />
        )}
    </SurfaceCard>
)
