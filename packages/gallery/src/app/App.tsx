import { Button, CoreGrammarRoot, Heading, Tabs, Text } from "@starci/grammar/core"
import { useState } from "react"
import type { ReactElement } from "react"
import { data } from "./data.ts"
import { fill, labelsFor } from "../labels.ts"
import type { Labels } from "../labels.ts"
import { ExplainPanel } from "./ExplainPanel.tsx"
import { FlowMap } from "./FlowMap.tsx"
import { useNarrow } from "./media.ts"
import { useRoute } from "./route.ts"
import type { Pane } from "./route.ts"
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

const PANEL_KEY = "starci-gallery:explain-open"

/** Whether the explanation panel is open: remembered per viewer, open when storage is blocked or empty. */
function storedOpen(): boolean {
    try {
        return window.localStorage.getItem(PANEL_KEY) !== "0"
    } catch {
        return true
    }
}

export function App(): ReactElement {
    const [explainOpen, setExplainOpen] = useState(storedOpen)
    const toggleExplain = (): void => {
        const next = !explainOpen
        setExplainOpen(next)
        try {
            window.localStorage.setItem(PANEL_KEY, next ? "1" : "0")
        } catch {
            // storage is blocked: the choice lasts until the page closes
        }
    }
    const [route, go] = useRoute()
    const narrow = useNarrow()
    const [pane, setPane] = useState<Pane>("design")
    const screen = route.screen === null ? null : (model.screens[route.screen] ?? null)
    const open = (id: string): void => {
        go({ screen: id, flows: false })
    }
    return (
        <CoreGrammarRoot>
            <div className="sg-shell" data-explain={explainOpen ? "open" : "closed"}>
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
                    {screen !== null && !route.flows ? <ViewSwitches labels={labels} width={route.width} view={route.view} showView={!narrow} onChange={go} /> : null}
                    {screen !== null && !route.flows && !narrow ? (
                        <Button intent="neutral" size="sm" onPress={toggleExplain}>
                            {explainOpen ? labels.hideExplain : labels.showExplain}
                        </Button>
                    ) : null}
                </header>
                <nav className="sg-tree" aria-label={labels.screens}>
                    <Tree model={model} labels={labels} selected={route.screen} onSelect={open} />
                </nav>
                <main className="sg-main">
                    {route.flows ? <FlowMap model={model} labels={labels} onOpen={open} /> : null}
                    {!route.flows && screen !== null ? (
                        <>
                            <States screen={screen} model={model} labels={labels} onOpen={open} />
                            {narrow ? (
                                <Tabs
                                    appearance="primary"
                                    label={labels.pane}
                                    selectedKey={pane}
                                    onSelect={(key) => {
                                        setPane(key as Pane)
                                    }}
                                    items={[
                                        { id: "design", label: labels.paneDesign },
                                        { id: "shot", label: labels.paneShot },
                                        { id: "slider", label: labels.viewSlider },
                                        { id: "explain", label: labels.explain },
                                    ]}
                                />
                            ) : null}
                            {narrow && pane === "explain" ? (
                                <div className="sg-explain-narrow">
                                    <ExplainPanel screen={screen} labels={labels} devUrl={devUrl} />
                                </div>
                            ) : (
                                <Viewer screen={screen} model={model} labels={labels} width={route.width} view={route.view} pane={narrow ? (pane === "explain" ? "design" : pane) : null} onOpen={open} />
                            )}
                        </>
                    ) : null}
                    {!route.flows && screen === null ? <Text tone="muted">{model.counts.total === 0 ? labels.empty : labels.screens}</Text> : null}
                </main>
                {!route.flows && screen !== null && explainOpen && !narrow ? (
                    <aside className="sg-explain" aria-label={labels.explain}>
                        <ExplainPanel screen={screen} labels={labels} devUrl={devUrl} />
                    </aside>
                ) : null}
            </div>
        </CoreGrammarRoot>
    )
}
