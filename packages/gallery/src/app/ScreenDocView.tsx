import { Alert, Badge, DisclosureList, Section, Text } from "@starci/grammar/core"
import type { ReactElement, ReactNode } from "react"
import { UNCLEAR_VALUE } from "../explain.ts"
import { fill } from "../labels.ts"
import type { Labels } from "../labels.ts"
import type { Screen } from "../model.ts"
import { LENSES } from "../screen.ts"
import type { AuditFlag, Lens, ScreenAudit, ScreenDoc, ScreenSection, Verdict } from "../screen.ts"
import { cap } from "./cap.ts"
import { Inline } from "./inline.tsx"

const VERDICT_TONE: Readonly<Record<Verdict, "success" | "accent" | "danger">> = { pass: "success", fixed: "accent", open: "danger" }
const verdictLabel = (labels: Labels, verdict: Verdict): string => ({ pass: labels.verdictPass, fixed: labels.verdictFixed, open: labels.verdictOpen })[verdict]
const lensLabel = (labels: Labels, lens: Lens): string =>
    ({ order: labels.lensOrder, layout: labels.lensLayout, actionable: labels.lensActionable, live: labels.lensLive, words: labels.lensWords, states: labels.lensStates, truth: labels.lensTruth })[lens]

/** The words of an audit flag: no audit, fewer than two rounds, an open lens in the latest round, needs owner. */
export const flagLabel = (labels: Labels, flag: AuditFlag): string => ({ none: labels.flagNone, few: labels.flagFew, open: labels.flagOpen, owner: labels.flagOwner })[flag.kind]

function Row({ term, children }: { readonly term: string; readonly children: ReactNode }): ReactElement {
    return (
        <div className="sg-row">
            <dt>
                <Text size="xs" tone="muted" isStrong>
                    {term}
                </Text>
            </dt>
            <dd>{children}</dd>
        </div>
    )
}

const whyProblem = (section: ScreenSection): "missing" | "unclear" | null => (section.why === "" ? "missing" : UNCLEAR_VALUE.test(section.why) ? "unclear" : null)

/** One section of screen.yaml: what it shows, why, its actions, its states (a chip per state with its text) and the "cần API" items. */
function SectionRows({ section, labels }: { readonly section: ScreenSection; readonly labels: Labels }): ReactElement {
    const problem = whyProblem(section)
    const text = (value: string): ReactElement => (
        <Text size="sm">
            <Inline text={value} />
        </Text>
    )
    return (
        <dl className="sg-rows">
            {problem === null ? null : (
                <div className="sg-row">
                    <Badge tone="danger">{fill(problem === "missing" ? labels.problemMissing : labels.problemUnclear, { field: labels.sectionWhy })}</Badge>
                </div>
            )}
            {section.shows === "" ? null : <Row term={labels.sectionShows}>{text(section.shows)}</Row>}
            {section.why === "" ? null : <Row term={labels.sectionWhy}>{text(section.why)}</Row>}
            {section.actions.length === 0 ? null : (
                <Row term={labels.sectionActions}>
                    <div className="sg-chips">
                        {section.actions.map((action) => (
                            <Badge key={action} tone="neutral">
                                {action}
                            </Badge>
                        ))}
                    </div>
                </Row>
            )}
            {section.states.length === 0 ? null : (
                <Row term={labels.sectionStates}>
                    <div className="sg-chips">
                        {section.states.map(([name, value]) => (
                            <span key={name} className="sg-state-chip">
                                <Badge tone={value === null ? "muted" : "accent"}>{name}</Badge>
                                {value === null ? null : <Text size="xs">{value}</Text>}
                            </span>
                        ))}
                    </div>
                </Row>
            )}
            {section.needsApi.length === 0 ? null : (
                <Row term={labels.needsApi}>
                    <div className="sg-chips">
                        {section.needsApi.map((item) => (
                            <Badge key={item} tone="warning">
                                {`${labels.needsApi}: ${item}`}
                            </Badge>
                        ))}
                    </div>
                </Row>
            )}
            {section.law === "" ? null : <Row term="Luật">{text(section.law)}</Row>}
            {section.grammar === "" ? null : <Row term="Grammar">{text(section.grammar)}</Row>}
        </dl>
    )
}

/** The audit of a screen: builder and auditor, the rounds as columns by the seven lenses as rows (the notes on hover and below), and the owner banner. */
function AuditTable({ audit, labels }: { readonly audit: ScreenAudit; readonly labels: Labels }): ReactElement {
    const noted = audit.rounds.flatMap((round) => LENSES.filter((lens) => round.lenses[lens].notes !== "").map((lens) => ({ round, lens, cell: round.lenses[lens] })))
    return (
        <div className="sg-explain-body">
            {audit.escalate === null ? null : <Alert tone="negative" title={labels.needsOwner} description={audit.escalate} />}
            <div className="sg-chips">
                <Text size="sm">{`${labels.auditBuilder}: ${audit.builder}`}</Text>
                <Text size="sm">{`${labels.auditAuditor}: ${audit.auditor}`}</Text>
            </div>
            <div className="sg-audit-scroll">
                <table className="sg-audit">
                    <thead>
                        <tr>
                            <th scope="col">
                                <Text size="xs" tone="muted" isStrong>
                                    {labels.auditLens}
                                </Text>
                            </th>
                            {audit.rounds.map((round) => (
                                <th key={round.n} scope="col">
                                    <Text size="xs" tone="muted" isStrong>
                                        {fill(labels.auditRound, { n: round.n })}
                                    </Text>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {LENSES.map((lens) => (
                            <tr key={lens}>
                                <th scope="row">
                                    <Text size="sm">{lensLabel(labels, lens)}</Text>
                                </th>
                                {audit.rounds.map((round) => {
                                    const cell = round.lenses[lens]
                                    return (
                                        <td key={round.n} title={cell.notes === "" ? undefined : cell.notes}>
                                            <Badge tone={VERDICT_TONE[cell.verdict]}>{verdictLabel(labels, cell.verdict)}</Badge>
                                        </td>
                                    )
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {noted.length === 0 ? null : (
                <dl className="sg-rows">
                    {noted.map(({ round, lens, cell }) => (
                        <Row key={`${String(round.n)}-${lens}`} term={`${fill(labels.auditRound, { n: round.n })} · ${lensLabel(labels, lens)}`}>
                            <div className="sg-chips">
                                <Badge tone={VERDICT_TONE[cell.verdict]}>{verdictLabel(labels, cell.verdict)}</Badge>
                                <Text size="sm">{cell.notes}</Text>
                            </div>
                        </Row>
                    ))}
                </dl>
            )}
        </div>
    )
}

/** The screen.yaml of a screen below its head: the flag, the summary, the code, the sections, the options considered and the audit. */
export function ScreenDocView({ doc, screen, labels }: { readonly doc: ScreenDoc; readonly screen: Screen; readonly labels: Labels }): ReactElement {
    return (
        <>
            {screen.auditFlag === null ? null : <Badge tone="danger">{flagLabel(labels, screen.auditFlag)}</Badge>}
            {doc.summary === "" ? null : (
                <Section title={labels.summary}>
                    <Text size="sm">
                        <Inline text={doc.summary} />
                    </Text>
                </Section>
            )}
            {doc.code.length === 0 ? null : (
                <Section title={labels.codeFiles}>
                    <ul className="sg-code">
                        {doc.code.map((file) => (
                            <li key={file}>
                                <Text size="xs" tone="muted" mono>
                                    {file}
                                </Text>
                            </li>
                        ))}
                    </ul>
                </Section>
            )}
            {doc.sections.length === 0 ? <Badge tone="danger">{labels.noRegions}</Badge> : null}
            {doc.sections.length === 0 ? null : (
                <Section title={labels.regions}>
                    <DisclosureList
                        label={labels.regions}
                        items={doc.sections.map((section) => ({
                            id: section.id || section.title,
                            title: cap(section.title),
                            headingLevel: 3 as const,
                            ...(whyProblem(section) !== null ? { summary: fill(labels.problems, { n: 1 }) } : section.needsApi.length > 0 ? { summary: labels.needsApi } : {}),
                            body: <SectionRows section={section} labels={labels} />,
                        }))}
                    />
                </Section>
            )}
            {doc.considered.length === 0 ? null : (
                <Section title={labels.considered}>
                    <dl className="sg-rows">
                        {doc.considered.map((entry) => (
                            <Row key={entry.option} term={entry.chosen ? labels.chosen : labels.rejected}>
                                <div className="sg-option">
                                    <Text size="sm" isStrong={entry.chosen}>
                                        {entry.option}
                                    </Text>
                                    {entry.why === "" ? null : (
                                        <Text size="xs" tone="muted">
                                            {entry.why}
                                        </Text>
                                    )}
                                </div>
                            </Row>
                        ))}
                    </dl>
                </Section>
            )}
            <Section title={labels.audit}>{doc.audit === null ? <Badge tone="muted">{labels.auditNone}</Badge> : <AuditTable audit={doc.audit} labels={labels} />}</Section>
        </>
    )
}
