import { CoreGrammarRoot, Heading, Tabs, Text } from "@starci/grammar/core"
import type { ReactElement } from "react"
import { data } from "./data.ts"
import { fill, labelsFor } from "../labels.ts"
import type { Labels } from "../labels.ts"
import { ExplainPanel } from "./ExplainPanel.tsx"
import { FlowMap } from "./FlowMap.tsx"
import { useRoute } from "./route.ts"
import { States } from "./States.tsx"
import { Tree } from "./Tree.tsx"
import { Viewer, ViewSwitches } from "./Viewer.tsx"

const { model, devUrl } = data
const labels: Labels = labelsFor(data.locale)

/** "67 màn · 41 khớp · 26 chưa code": the screens, how many match and how many are not built; the others only when there are some. */
function summary(): string {
    const { counts } = model
    return [
        fill(labels.counts, { total: counts.total }),
        fill(labels.countsMatches, { n: counts.matches }),
        ...(counts.differs > 0 ? [fill(labels.countsDiffers, { n: counts.differs })] : []),
        ...(counts.stale > 0 ? [fill(labels.countsStale, { n: counts.stale })] : []),
        fill(labels.countsNotBuilt, { n: counts.notBuilt }),
    ].join(" · ")
}

export function App(): ReactElement {
    const [route, go] = useRoute()
    const screen = route.screen === null ? null : (model.screens[route.screen] ?? null)
    const open = (id: string): void => {
        go({ screen: id, flows: false })
    }
    return (
        <CoreGrammarRoot>
            <div className="sg-shell">
                <header className="sg-top">
                    <div className="sg-brand">
                        <Heading level={1}>{fill(labels.title, { app: data.app })}</Heading>
                        <Text size="sm" tone="muted" tabular>
                            {summary()}
                        </Text>
                        {model.counts.hidden > 0 ? (
                            <Text size="xs" tone="muted">
                                {fill(labels.hidden, { n: model.counts.hidden })}
                            </Text>
                        ) : null}
                    </div>
                    <Tabs
                        appearance="primary"
                        label={labels.view}
                        selectedKey={route.flows ? "flows" : "screens"}
                        onSelect={(key) => {
                            go({ flows: key === "flows", screen: key === "flows" ? null : route.screen })
                        }}
                        items={[
                            { id: "screens", label: labels.screens },
                            { id: "flows", label: labels.flows },
                        ]}
                    />
                    {screen !== null && !route.flows ? <ViewSwitches labels={labels} width={route.width} view={route.view} onChange={go} /> : null}
                </header>
                <nav className="sg-tree" aria-label={labels.screens}>
                    <Tree model={model} labels={labels} selected={route.screen} onSelect={open} />
                </nav>
                <main className="sg-main">
                    {route.flows ? <FlowMap model={model} labels={labels} onOpen={open} /> : null}
                    {!route.flows && screen !== null ? (
                        <>
                            <States screen={screen} model={model} labels={labels} onOpen={open} />
                            <Viewer screen={screen} model={model} labels={labels} width={route.width} view={route.view} onOpen={open} />
                        </>
                    ) : null}
                    {!route.flows && screen === null ? <Text tone="muted">{model.counts.total === 0 ? labels.empty : labels.screens}</Text> : null}
                </main>
                {!route.flows && screen !== null ? (
                    <aside className="sg-explain" aria-label={labels.explain}>
                        <ExplainPanel screen={screen} labels={labels} devUrl={devUrl} />
                    </aside>
                ) : null}
            </div>
        </CoreGrammarRoot>
    )
}
