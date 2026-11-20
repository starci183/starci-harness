import { Badge, CoreGrammarRoot, Heading, IconButton, Tabs, Text, Tooltip } from "@starci/grammar/core"
import { useState } from "react"
import type { ReactElement } from "react"
import { Board } from "./Board.tsx"
import { data } from "./data.ts"
import { fill, labelsFor } from "../labels.ts"
import type { Labels } from "../labels.ts"
import { ExplainPanel } from "./ExplainPanel.tsx"
import { FlowMap } from "./FlowMap.tsx"
import { useNarrow } from "./media.ts"
import { statusLabel, TONE } from "./status.ts"
import { useRoute } from "./route.ts"
import type { Pane } from "./route.ts"
import { COMPARE_VIEWS, effectiveView } from "../views.ts"
import { States } from "./States.tsx"
import { Legend } from "./Legend.tsx"
import { Tree } from "./Tree.tsx"
import { CompareModes, Viewer, ViewSwitches } from "./Viewer.tsx"

const { model, devUrl, board } = data
const labels: Labels = labelsFor(data.locale)

/** "67 màn · 41 khớp · 26 chưa code": the screens, how many match and how many have no shot; the other counts only when there are some. They add up: total = khớp + lệch + cũ + đã code chưa ghi duyệt + chưa code. */
function summary(): string {
    const { counts } = model
    return [
        fill(labels.counts, { total: counts.total }),
        fill(labels.countsMatches, { n: counts.matches }),
        ...(counts.differs > 0 ? [fill(labels.countsDiffers, { n: counts.differs })] : []),
        ...(counts.stale > 0 ? [fill(labels.countsStale, { n: counts.stale })] : []),
        ...(counts.unrecorded > 0 ? [fill(labels.countsUnrecorded, { n: counts.unrecorded })] : []),
        fill(labels.countsNotCoded, { n: counts.notCoded }),
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
    const hasDesign = screen?.frame?.widths.includes(route.width) ?? false
    const hasShot = screen?.shots.includes(route.width) ?? false
    const view = effectiveView(route.view, hasDesign, hasShot)
    const open = (id: string): void => {
        go({ screen: id, flows: false, board: false })
    }
    return (
        <CoreGrammarRoot>
            <div className="sg-shell" data-explain={explainOpen ? "open" : "closed"}>
                <header className="sg-top">
                    <div className="sg-brand">
                        <div className="sg-title">
                            <Heading level={1}>{fill(labels.title, { app: data.app })}</Heading>
                            <Text size="xs" tone="muted" tabular>
                                {model.counts.hidden > 0 ? `${summary()} · ${fill(labels.hidden, { n: model.counts.hidden })}` : summary()}
                            </Text>
                        </div>
                        <Legend labels={labels} />
                    </div>
                    <Tabs
                        appearance="primary"
                        label={labels.view}
                        selectedKey={route.board ? "board" : route.flows ? "flows" : "screens"}
                        onSelect={(key) => {
                            go({ flows: key === "flows", board: key === "board", screen: key === "screens" ? route.screen : null })
                        }}
                        items={
                            board === null
                                ? [
                                      { id: "screens", label: labels.screens },
                                      { id: "flows", label: labels.flows },
                                  ]
                                : [
                                      { id: "screens", label: labels.screens },
                                      { id: "flows", label: labels.flows },
                                      { id: "board", label: labels.boardView },
                                  ]
                        }
                    />
                    {screen !== null && !route.flows ? <ViewSwitches labels={labels} width={route.width} view={view} hasDesign={hasDesign} hasShot={hasShot} showView={!narrow} onChange={go} /> : null}
                    {screen !== null && !route.flows && !narrow ? (
                        <Tooltip
                            content={explainOpen ? labels.hideExplain : labels.showExplain}
                            trigger={<IconButton glyph="panel-end" intent="neutral" size="sm" label={explainOpen ? labels.hideExplain : labels.showExplain} isActive={explainOpen} aria-expanded={explainOpen} onPress={toggleExplain} />}
                        />
                    ) : null}
                </header>
                <nav className="sg-tree" aria-label={labels.screens}>
                    <Tree model={model} labels={labels} selected={route.screen} onSelect={open} />
                </nav>
                <main className="sg-main">
                    {route.flows ? <FlowMap model={model} labels={labels} onOpen={open} /> : null}
                    {route.board && board !== null ? <Board board={board} model={model} labels={labels} onOpen={open} /> : null}
                    {!route.flows && screen !== null ? (
                        <>
                            <States screen={screen} model={model} labels={labels} onOpen={open} />
                            {(!narrow && COMPARE_VIEWS.includes(view)) || (narrow && pane === "compare" && hasDesign && hasShot) ? (
                                <CompareModes
                                    labels={labels}
                                    view={COMPARE_VIEWS.includes(view) ? view : "slider"}
                                    onChange={(next) => {
                                        go({ view: next })
                                    }}
                                />
                            ) : null}
                            {hasDesign && hasShot ? null : (
                                <div className="sg-reason">
                                    <Text size="sm" tone="muted">
                                        {hasDesign ? labels.reasonNoShot : labels.reasonNoDesign}
                                    </Text>
                                    </div>
                            )}
                            {narrow ? (
                                <div className="sg-reason">
                                    <Badge isDot tone={TONE[screen.status]}>
                                        {statusLabel(labels, screen.status, screen.designStatus, screen.pending)}
                                    </Badge>
                                </div>
                            ) : null}
                            {narrow ? (
                                <Tabs
                                    appearance="primary"
                                    label={labels.pane}
                                    selectedKey={pane}
                                    onSelect={(key) => {
                                        setPane(key as Pane)
                                    }}
                                    items={[
                                        { id: "design", label: labels.paneDesign, isDisabled: !hasDesign },
                                        { id: "shot", label: labels.paneShot, isDisabled: !hasShot },
                                        { id: "compare", label: labels.viewCompare, isDisabled: !(hasDesign && hasShot) },
                                        { id: "explain", label: labels.explain },
                                    ]}
                                />
                            ) : null}
                            {narrow && pane === "explain" ? (
                                <div className="sg-explain-narrow">
                                    <ExplainPanel screen={screen} labels={labels} devUrl={devUrl} />
                                </div>
                            ) : (
                                <Viewer screen={screen} model={model} labels={labels} width={route.width} view={view} pane={narrow ? (pane === "explain" ? "design" : pane) : null} onOpen={open} />
                            )}
                        </>
                    ) : null}
                    {!route.flows && !route.board && screen === null ? <Text tone="muted">{model.counts.total === 0 ? labels.empty : labels.screens}</Text> : null}
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
