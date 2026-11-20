import { Badge, Divider, DisclosureList, Heading, Link, Section, Text } from "@starci/grammar/core"
import type { ReactElement } from "react"
import { FIELDS, introClauses } from "../explain.ts"
import type { Region } from "../explain.ts"
import { fill } from "../labels.ts"
import type { Labels } from "../labels.ts"
import { devPath } from "../model.ts"
import type { Screen } from "../model.ts"
import { cap } from "./cap.ts"
import { Inline } from "./inline.tsx"
import { ScreenDocView } from "./ScreenDocView.tsx"
import { statusLabel, TONE } from "./status.ts"

export interface ExplainProps {
    readonly screen: Screen
    readonly labels: Labels
    readonly devUrl: string | null
}

/** A region that is the business reading of the screen (Nghiệp vụ, Tổng quan, Phản biện): read first, open. Every other region folds its lines behind its title. */
const OVERVIEW = /nghiệp vụ|tổng quan|phản biện|overview|business|critique/iu
const isOverview = (region: Region): boolean => OVERVIEW.test(region.name)

function Rows({ region, labels }: { readonly region: Region; readonly labels: Labels }): ReactElement {
    return (
        <dl className="sg-rows">
            {region.problems.map((problem) => (
                <div key={`${problem.kind}-${problem.field}`} className="sg-row">
                    <Badge tone="danger">{fill(problem.kind === "missing" ? labels.problemMissing : labels.problemUnclear, { field: problem.field })}</Badge>
                </div>
            ))}
            {FIELDS.map((field) => {
                const value = region.fields[field]
                return value === undefined || value === "" ? null : (
                    <div key={field} className="sg-row">
                        <dt>
                            <Text size="xs" tone="muted" isStrong>
                                {field}
                            </Text>
                        </dt>
                        <dd>
                            <Text size="sm">
                                <Inline text={value} />
                            </Text>
                        </dd>
                    </div>
                )
            })}
        </dl>
    )
}

/**
 * The explain.md of a screen: its id and status, the way to the dev app, the overview first (the introduction as rows, then the business regions), and each other region as one
 * disclosure, closed, so its title stays visible and its Vì sao, Luật and Grammar lines open on a press.
 */
export function ExplainPanel({ screen, labels, devUrl }: ExplainProps): ReactElement {
    const explain = screen.explain
    const dev = devUrl !== null && devPath(screen.route) !== null ? `${devUrl.replace(/\/$/u, "")}${screen.route ?? ""}` : null
    const regions = explain?.regions ?? []
    const overview = regions.filter(isOverview)
    const rest = regions.filter((region) => !isOverview(region))
    return (
        <div className="sg-explain-body">
            <div className="sg-explain-head">
                <Heading level={2}>{cap(screen.title)}</Heading>
                <div className="sg-chips">
                    <Badge isDot tone={TONE[screen.status]}>
                        {statusLabel(labels, screen.status, screen.designStatus, screen.pending)}
                    </Badge>
                    <Text size="xs" tone="muted" mono>
                        {screen.id}
                    </Text>
                </div>
                {screen.status === "unrecorded" || screen.status === "codedOnly" ? (
                    <Text size="sm" tone="muted">
                        {labels.unrecordedHint}
                    </Text>
                ) : null}
                {screen.route === null ? null : (
                    <Text size="sm" tone="muted" mono>
                        {`${labels.route}: ${screen.route}`}
                    </Text>
                )}
                <div className="sg-chips">
                    {dev === null ? null : (
                        <Link href={dev} kind="external" externalHint="">
                            {labels.openDev}
                        </Link>
                    )}
                    {screen.board === null ? null : (
                        <Link href={screen.board} kind="external" externalHint="">
                            {labels.board}
                        </Link>
                    )}
                </div>
            </div>
            <Divider />
            {screen.doc !== null ? <ScreenDocView doc={screen.doc} screen={screen} labels={labels} /> : null}
            {screen.doc === null && explain === null ? <Text tone="muted">{labels.noExplain}</Text> : null}
            {screen.doc === null && explain !== null && explain.intro !== "" ? (
                <Section title={labels.intro}>
                    <dl className="sg-rows">
                        {introClauses(explain.intro).map((row, index) => (
                            <div key={index} className="sg-row">
                                {row.label === null ? null : (
                                    <dt>
                                        <Text size="xs" tone="muted" isStrong>
                                            {row.label}
                                        </Text>
                                    </dt>
                                )}
                                <dd>
                                    <Text size="sm">
                                        <Inline text={row.text} />
                                    </Text>
                                </dd>
                            </div>
                        ))}
                    </dl>
                </Section>
            ) : null}
            {screen.doc === null && explain !== null && regions.length === 0 ? <Badge tone="danger">{labels.noRegions}</Badge> : null}
            {(screen.doc === null ? overview : []).map((region) => (
                <Section key={region.name} title={cap(region.name)}>
                    <Rows region={region} labels={labels} />
                </Section>
            ))}
            {screen.doc !== null || rest.length === 0 ? null : (
                <Section title={labels.regions}>
                    <DisclosureList
                        label={labels.regions}
                        items={rest.map((region) => ({
                            id: region.name,
                            title: cap(region.name),
                            headingLevel: 3 as const,
                            ...(region.problems.length === 0 ? {} : { summary: fill(labels.problems, { n: region.problems.length }) }),
                            body: <Rows region={region} labels={labels} />,
                        }))}
                    />
                </Section>
            )}
        </div>
    )
}
