// One frame of the design board (PROJECT-GALLERY-9): `/__board/frame.html?s=<area>/<screen>&state=<state>&w=<width>` mounts the section's module in one state inside the
// Grammar root, with the Grammar's stylesheet and the app's tokens (the board module imports them), and tells the board its content height so the frame fits the screen.
// The Grammar's stylesheet loads first, so the app's tokens (imported by the board module below) override its theme.
import "./board-frame.css"
import { Alert, CoreGrammarRoot } from "@starci/grammar/core"
import { StrictMode, useEffect, useState } from "react"
import type { ComponentType, ReactElement } from "react"
import { createRoot } from "react-dom/client"
import { sections } from "virtual:starci-gallery/board"
import { boardFrameKey, DEFAULT_STATE } from "../board.ts"
import type { BoardFrameHeight } from "../board.ts"

const params = new URLSearchParams(window.location.search)
const id = params.get("s") ?? ""
const state = params.get("state") ?? DEFAULT_STATE
const key = boardFrameKey(id, state, params.get("w") ?? "")

type Drawn = ComponentType<{ readonly state: string }>

function Frame(): ReactElement {
    const [drawn, setDrawn] = useState<{ readonly Section: Drawn } | { readonly error: string } | null>(null)
    useEffect(() => {
        const load = sections[id]
        if (load === undefined) {
            setDrawn({ error: `no module for ${id}` })
            return
        }
        load().then(
            (module) => { setDrawn({ Section: module.default }) },
            (error: unknown) => { setDrawn({ error: error instanceof Error ? error.message : String(error) }) },
        )
    }, [])
    if (drawn === null) return <></>
    if ("error" in drawn) return <Alert tone="negative" title={id} description={drawn.error} />
    const { Section } = drawn
    return <Section state={state} />
}

const mount = document.querySelector("#root")
if (mount !== null) {
    createRoot(mount).render(
        <StrictMode>
            <CoreGrammarRoot>
                <Frame />
            </CoreGrammarRoot>
        </StrictMode>,
    )
    const report = (): void => {
        // the content, not the viewport: a short screen shrinks its frame, a full-height shell keeps the height it is given
        const message: BoardFrameHeight = { kind: "starci-board-height", key, height: Math.max(1, Math.ceil(mount.scrollHeight)) }
        window.parent.postMessage(message, window.location.origin)
    }
    new ResizeObserver(report).observe(mount)
}
