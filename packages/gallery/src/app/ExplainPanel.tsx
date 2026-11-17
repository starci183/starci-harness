import type { ReactElement } from "react"
import { Badge, Divider, Heading, Link, Section, Text } from "@starci/grammar/core"
import { FIELDS, introClauses } from "../explain.ts"
import { fill } from "../labels.ts"
import type { Labels } from "../labels.ts"
import { devPath } from "../model.ts"
import type { Screen } from "../model.ts"
import { Inline } from "./inline.tsx"
import { statusLabel, TONE } from "./status.ts"

export interface ExplainProps {
    readonly screen: Screen
    readonly labels: Labels
    readonly devUrl: string | null
}

/** The explain.md of a screen: its id and status, the way to the dev app, the overview as rows and each region with its Vì sao, Luật and Grammar lines. */
export function ExplainPanel({ screen, labels, devUrl }: ExplainProps): ReactElement {
    const explain = screen.explain
    const dev = devUrl !== null && devPath(screen.route) !== null ? `${devUrl.replace(/\/$/u, "")}${screen.route ?? ""}` : null
    const tone = TONE[screen.status]
    return (
        <div className="sg-explain-body">
            <div className="sg-explain-head">
                <Heading level={2}>{screen.title}</Heading>
                <div className="sg-chips">
                    <Badge isDot tone={tone}>{statusLabel(labels, screen.status)}</Badge>
                    <Text size="xs" tone="muted" mono>{screen.id}</Text>
                </div>
                {screen.route === null ? null : <Text size="sm" tone="muted" mono>{`${labels.route}: ${screen.route}`}</Text>}
                <div className="sg-chips">
                    {dev === null ? null : <Link href={dev} kind="external" externalHint="">{labels.openDev}</Link>}
                    {screen.board === null ? null : <Link href={screen.board} kind="external" externalHint="">{labels.board}</Link>}
                </div>
            </div>
            <Divider />
            {explain === null ? <Text tone="muted">{labels.noExplain}</Text> : null}
            {explain !== null && explain.intro !== "" ? (
                <Section title={labels.intro}>
                    <dl className="sg-rows">
                        {introClauses(explain.intro).map((row, index) => (
                            <div key={index} className="sg-row">
                                {row.label === null ? null : <dt><Text size="xs" tone="muted" isStrong>{row.label}</Text></dt>}
                                <dd><Text size="sm"><Inline text={row.text} /></Text></dd>
                            </div>
                        ))}
                    </dl>
                </Section>
            ) : null}
            {explain !== null && explain.regions.length === 0 ? <Badge tone="danger">{labels.noRegions}</Badge> : null}
            {explain?.regions.map((region) => (
                <Section key={region.name} title={region.name}>
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
                                    <dt><Text size="xs" tone="muted" isStrong>{field}</Text></dt>
                                    <dd><Text size="sm"><Inline text={value} /></Text></dd>
                                </div>
                            )
                        })}
                    </dl>
                </Section>
            ))}
        </div>
    )
}
