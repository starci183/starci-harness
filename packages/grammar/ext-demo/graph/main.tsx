import "../../src/core/styles.css"
import "../../src/core/theme.css"
import "../../src/core/ext/graph/styles.css"
import "./tokens.css"
import { StrictMode } from "react"
import { CoreGrammarRoot } from "../../src/core/index.ts"
import { createRoot } from "react-dom/client"
import { FLOWS, FlowStory, MIXES, type Mix } from "./flows.tsx"
import { ERD_STORIES } from "./erd.tsx"
import { KNOWLEDGE_STORIES } from "./knowledge.tsx"
import { STORIES, StoryView } from "./stories.tsx"
import { NIVO_STORIES } from "./nivo.tsx"

interface StoryMeta {
    readonly id: string
    readonly mix: string
    readonly spine: readonly string[]
    readonly decisions: readonly { readonly id: string; readonly left: string; readonly right: string }[]
    readonly crossings: number
}

const params = new URLSearchParams(window.location.search)
document.documentElement.dataset.theme = params.get("theme") === "dark" ? "dark" : "light"
const id = params.get("story")
const mix = MIXES.find((candidate) => candidate === params.get("mix")) ?? "running"
const flow = FLOWS.find((candidate) => candidate.id === id)
const story = [...STORIES, ...ERD_STORIES, ...NIVO_STORIES].find((candidate) => candidate.id === id)
const knowledge = KNOWLEDGE_STORIES.find((candidate) => candidate.id === id)
const root = document.getElementById("root")

/** The story on the page (its spine, its decisions and how many crossings it may have), on `window.graphStory` for a look from the browser console. */
const meta: StoryMeta = { id: id ?? "", mix: flow === undefined ? "" : mix, spine: flow?.spine ?? [], decisions: flow?.decisions ?? [], crossings: flow?.crossings ?? 0 }
Object.assign(window, { graphStory: meta })

const Index = (): React.ReactElement => (
    <ul className="demo-page">
        {[...FLOWS, ...STORIES, ...ERD_STORIES, ...NIVO_STORIES, ...KNOWLEDGE_STORIES].map((entry) => (
            <li key={entry.id}>
                <a href={`?story=${entry.id}`}>{entry.title}</a>
            </li>
        ))}
    </ul>
)

const Flow = ({ chosen, state }: { readonly chosen: (typeof FLOWS)[number]; readonly state: Mix }): React.ReactElement => (
    <div className="demo-page">
        <h1 className="demo-title">{chosen.title}</h1>
        <p className="demo-note">{chosen.note}</p>
        <div className="demo-frame" aria-label={chosen.id}>
            <FlowStory flow={chosen} mix={state} />
        </div>
    </div>
)

const Knowledge = ({ story: chosen }: { readonly story: (typeof KNOWLEDGE_STORIES)[number] }): React.ReactElement => (
    <div className="demo-page">
        <h1 className="demo-title">{chosen.title}</h1>
        <p className="demo-note">{chosen.note}</p>
        <div className="demo-frame" aria-label={chosen.id}>
            {chosen.render()}
        </div>
    </div>
)

if (root !== null) {
    createRoot(root).render(
        <StrictMode>
            {/* The graph is a Grammar component: it reads the Grammar's ramps, which live on the root. */}
            <CoreGrammarRoot>{flow !== undefined ? <Flow chosen={flow} state={mix} /> : story !== undefined ? <StoryView story={story} /> : knowledge !== undefined ? <Knowledge story={knowledge} /> : <Index />}</CoreGrammarRoot>
        </StrictMode>,
    )
}
