// The design board view (`#/board`, PROJECT-GALLERY-9): every section of the app's board, grouped by area, each with its route, the screen.yaml it becomes, its states and its
// "cần API" marks, and every state drawn at 1440 and 390 side by side at one scale. Each frame is its own page (`/__board/frame.html`), so a 390 frame is a 390 viewport and the
// Grammar's responsive rules see the real width; the frame reports its height and the board sizes it to the screen it draws.
import { Badge, Heading, Link, Section, Text } from "@starci/grammar/core"
import { useEffect, useRef, useState } from "react"
import type { ReactElement, RefObject } from "react"
import { BOARD_WIDTHS, boardFrameKey, boardFrameUrl } from "../board.ts"
import type { Board as BoardData, BoardFrameHeight, BoardSection, BoardWidth } from "../board.ts"
import { fill } from "../labels.ts"
import type { Labels } from "../labels.ts"
import type { Model } from "../model.ts"
import { cap } from "./cap.ts"

/** The gap between the two frames of a state, in board pixels before scaling. */
const GAP = 48
/** The height a frame takes before it has reported its own. */
const FIRST_HEIGHT = 900

/** The content heights the frames reported, by frame key. */
function useFrameHeights(): Readonly<Record<string, number>> {
    const [heights, setHeights] = useState<Readonly<Record<string, number>>>({})
    useEffect(() => {
        const onMessage = (event: MessageEvent<unknown>): void => {
            if (event.origin !== window.location.origin) return
            const message = event.data as Partial<BoardFrameHeight> | null
            if (message?.kind !== "starci-board-height" || typeof message.key !== "string" || typeof message.height !== "number") return
            const { key, height } = message
            setHeights((known) => (known[key] === height ? known : { ...known, [key]: height }))
        }
        window.addEventListener("message", onMessage)
        return () => { window.removeEventListener("message", onMessage) }
    }, [])
    return heights
}

/** The width of an element, followed as it resizes. */
function useWidth(): [RefObject<HTMLDivElement | null>, number] {
    const ref = useRef<HTMLDivElement | null>(null)
    const [width, setWidth] = useState(0)
    useEffect(() => {
        const element = ref.current
        if (element === null) return
        const observer = new ResizeObserver(() => { setWidth(element.clientWidth) })
        observer.observe(element)
        setWidth(element.clientWidth)
        return () => { observer.disconnect() }
    }, [])
    return [ref, width]
}

interface StateRowProps {
    readonly section: BoardSection
    readonly state: string
    readonly heights: Readonly<Record<string, number>>
    readonly labels: Labels
}

/** One state of a section: its frames at 1440 and 390, side by side at the one scale that fits both in the row. */
function StateRow({ section, state, heights, labels }: StateRowProps): ReactElement {
    const [ref, width] = useWidth()
    const scale = width === 0 ? 0.5 : Math.min(1, width / (1440 + 390 + GAP))
    const frame = (frameWidth: BoardWidth): ReactElement => {
        const height = heights[boardFrameKey(section.id, state, frameWidth)] ?? FIRST_HEIGHT
        return (
            <div key={frameWidth} className="sg-db-frame" style={{ width: Number(frameWidth) * scale, height: height * scale }}>
                <iframe
                    title={`${section.title} · ${state} · ${frameWidth}`}
                    src={boardFrameUrl(section.id, state, frameWidth)}
                    loading="lazy"
                    style={{ width: Number(frameWidth), height, transform: `scale(${String(scale)})` }}
                />
            </div>
        )
    }
    return (
        <div className="sg-db-state">
            <Text size="sm" tone="muted">{fill(labels.boardState, { state })}</Text>
            <div ref={ref} className="sg-db-frames" style={{ gap: GAP * scale }}>
                {BOARD_WIDTHS.map(frame)}
            </div>
        </div>
    )
}

interface BoardSectionProps {
    readonly section: BoardSection
    readonly model: Model
    readonly labels: Labels
    readonly heights: Readonly<Record<string, number>>
    readonly onOpen: (id: string) => void
}

/** One section: its head (title, route, the screen.yaml it becomes, its marks), then every state. */
function BoardSectionView({ section, model, labels, heights, onOpen }: BoardSectionProps): ReactElement {
    const screen = model.screens[section.id]
    return (
        <Section title={section.title} meta={`${section.route} · gallery/pages/${section.id}/screen.yaml`} headingLevel={3}>
            <div className="sg-chips">
                {section.planned ? <Badge tone="muted">{labels.boardPlanned}</Badge> : null}
                {section.needsApi.map((op) => <Badge key={op} tone="warning">{fill(labels.boardNeedsApi, { op })}</Badge>)}
                {section.hasModule ? null : <Badge tone="danger">{fill(labels.boardNoModule, { file: `gallery/board/${section.id}.tsx` })}</Badge>}
                {screen === undefined ? null : (
                    <Link href={`#/${section.id}`} onFollow={() => { onOpen(section.id) }}>
                        {labels.boardOpenScreen}
                    </Link>
                )}
            </div>
            {section.hasModule ? section.states.map((state) => <StateRow key={state} section={section} state={state} heights={heights} labels={labels} />) : null}
        </Section>
    )
}

export interface BoardProps {
    readonly board: BoardData
    readonly model: Model
    readonly labels: Labels
    readonly onOpen: (id: string) => void
}

/** The whole board: its revision and approval, then the sections area by area. */
export function Board({ board, model, labels, onOpen }: BoardProps): ReactElement {
    const heights = useFrameHeights()
    const areas = [...new Set(board.sections.map((section) => section.area))]
    const facts = [
        board.revision === null ? null : fill(labels.boardRevision, { n: board.revision }),
        board.approvedAt === null ? labels.boardUnapproved : fill(labels.boardApproved, { at: board.approvedAt }),
        board.problems.length === 0 ? null : fill(labels.boardSkipped, { list: board.problems.join("; ") }),
    ].filter((fact): fact is string => fact !== null)
    return (
        <div className="sg-db">
            <Text size="sm" tone="muted">{facts.join(" · ")}</Text>
            {board.sections.length === 0 ? <Text tone="muted">{labels.boardEmpty}</Text> : null}
            {areas.map((area) => (
                <div key={area} className="sg-db-area">
                    <Heading level={2}>{cap(area)}</Heading>
                    {board.sections.filter((section) => section.area === area).map((section) => (
                        <BoardSectionView key={section.id} section={section} model={model} labels={labels} heights={heights} onOpen={onOpen} />
                    ))}
                </div>
            ))}
        </div>
    )
}
