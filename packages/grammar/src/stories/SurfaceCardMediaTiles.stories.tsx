import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, within } from "storybook/test"
import * as G from "../common/index.js"
import type { ItemMenu, TileData, TilePoster } from "../core/surfaceCardData.js"
import { Matrix, State, noop, placeholderImage } from "./fixtures.js"

const meta: Meta = { title: "Surfaces/Media tiles" }
export default meta
type Story = StoryObj

const mediaTile = (name: string, poster: TilePoster, canEdit = true, busy = false): TileData => {
    const menu: ItemMenu = {
        label: `More actions for ${name}`,
        entries: [
            { id: "duplicate", label: "Duplicate", isDisabled: busy, onAction: noop },
            { id: "archive", label: "Archive", tone: "danger", isDisabled: busy || name === "Archived", onAction: noop },
        ],
    }
    return {
        name,
        poster,
        badges: [
            { label: "Ready", tone: "success" },
            { label: "Awareness", tone: "neutral" },
            { label: "Landscape", tone: "neutral" },
        ],
        facts: "12 scenes · 1 min 24 sec · Updated today",
        action: { label: `Open ${name}`, href: `#${encodeURIComponent(name)}` },
        ...(canEdit ? { menu } : {}),
    }
}

const poster: TilePoster = { image: { src: placeholderImage("Preview"), alt: "Video preview", width: 640, height: 400 }, aspect: "landscape", fit: "contain" }
const missingPoster: TilePoster = { absence: "No poster available", aspect: "landscape" }

export const MediaPeers: Story = {
    render: () => (
        <G.Grid kind="cards" columns={3}>
            <G.SurfaceCard kind="tile" {...mediaTile("Launch", poster)} />
            <G.SurfaceCard kind="tile" {...mediaTile("Read only", missingPoster, false)} />
            <G.SurfaceCard kind="tile" {...mediaTile("Busy", poster, true, true)} />
        </G.Grid>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByRole("link", { name: "Open Launch" })).toHaveAttribute("href", "#Launch")
        await expect(canvas.getByRole("link", { name: "Open Read only" })).toBeInTheDocument()
        await expect(canvas.getByText("No poster available")).toBeVisible()
        await expect(canvas.queryByRole("button", { name: "More actions for Read only" })).not.toBeInTheDocument()
        for (const frame of canvasElement.querySelectorAll("[data-grammar-tile-poster]")) {
            const box = frame.getBoundingClientRect()
            await expect(box.width / box.height).toBeCloseTo(4 / 3, 2)
        }
        await userEvent.click(canvas.getByRole("button", { name: "More actions for Busy" }))
        const page = within(canvasElement.ownerDocument.body)
        await expect(await page.findByRole("menuitem", { name: "Duplicate" })).toHaveAttribute("aria-disabled", "true")
        await expect(page.getByRole("menuitem", { name: "Archive" })).toHaveAttribute("aria-disabled", "true")
        await userEvent.keyboard("{Escape}")
    },
}

const sameTile = mediaTile("A long media title that keeps all of its words", missingPoster)

export const InitialLoading: Story = {
    render: () => (
        <Matrix maxWidth={960}>
            <State label="Ready" direction="column"><G.Grid kind="cards" columns={3}><G.SurfaceCard kind="tile" {...sameTile} /></G.Grid></State>
            <State label="Loading" direction="column"><G.Grid kind="cards" columns={3}><G.SurfaceCard kind="tile" {...sameTile} isLoading /></G.Grid></State>
        </Matrix>
    ),
    play: async ({ canvasElement }) => {
        const ready = canvasElement.querySelector<HTMLElement>('[data-story-state="Ready"] [data-grammar-tile="true"]')
        const loading = canvasElement.querySelector<HTMLElement>('[data-story-state="Loading"] [data-grammar-tile="true"]')
        if (ready === null || loading === null) throw new Error("The story must render both tile faces")
        await expect(loading.getBoundingClientRect().height).toBeCloseTo(ready.getBoundingClientRect().height, 0)
        await expect(within(loading).queryByRole("button")).not.toBeInTheDocument()
        await expect(within(loading).queryByRole("link")).not.toBeInTheDocument()
        await expect(loading.querySelectorAll('[data-component="Badge"]')).toHaveLength(3)
        await expect(loading.querySelector('[data-grammar-tile-facts="true"]')).toBeInTheDocument()
    },
}
