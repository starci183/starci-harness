import type { ReactElement } from "react"
import { Section, Text } from "@starci/grammar/core"
import { cap } from "./cap.ts"
import type { Labels } from "../labels.ts"
import type { Model } from "../model.ts"

/** The flow map (PROJECT-GALLERY-3): each named flow as its screens in order, then every link of every links.json as an edge. Each step opens its screen. */
export function FlowMap({ model, labels, onOpen }: { readonly model: Model; readonly labels: Labels; readonly onOpen: (id: string) => void }): ReactElement {
    const edges = Object.values(model.screens).flatMap((screen) => screen.links.map((link) => [screen.id, link.to] as const))
    if (model.flows.length === 0 && edges.length === 0) return <Text tone="muted">{labels.noFlows}</Text>
    const step = (id: string) => {
        const screen = model.screens[id]
        return screen === undefined ? (
            <Text key={id} tone="muted" mono>
                {id}
            </Text>
        ) : (
            <button key={id} type="button" className="sg-step" onClick={() => { onOpen(id) }}>
                <Text size="sm" isStrong>{cap(screen.title)}</Text>
                <Text size="xs" tone="muted" mono>{id}</Text>
            </button>
        )
    }
    return (
        <div className="sg-flows">
            {model.flows.map((flow) => (
                <Section key={flow.name} title={cap(flow.name)}>
                    <ol className="sg-flow">
                        {flow.screens.map((id, index) => (
                            <li key={`${id}-${String(index)}`} className="sg-edge">
                                {index > 0 ? <Text tone="muted">→</Text> : null}
                                {step(id)}
                            </li>
                        ))}
                    </ol>
                </Section>
            ))}
            {edges.length > 0 ? (
                <Section title={labels.linksHeading}>
                    <ul className="sg-edges">
                        {edges.map(([from, to], index) => (
                            <li key={`${from}-${to}-${String(index)}`} className="sg-edge">
                                {step(from)}
                                <Text tone="muted">→</Text>
                                {step(to)}
                            </li>
                        ))}
                    </ul>
                </Section>
            ) : null}
        </div>
    )
}
