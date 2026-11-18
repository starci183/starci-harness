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

const poster: TilePoster = { image: { src: placeholderImage("Preview"), alt: "Video preview" }, aspect: "landscape", fit: "contain" }
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

const BLEED_ASPECTS = ["landscape", "square", "portrait"] as const
const bleedTile = (name: string, base: TilePoster, extra: Partial<TileData> = {}): TileData => ({
    name,
    poster: { ...base, bleed: true },
    badges: [{ label: "Ready", tone: "success" }],
    facts: "120.000 d",
    figure: "120.000 d",
    action: { label: "Add", press: noop },
    ...extra,
} as TileData)

/** A product picture is full-bleed: flush to the card's top and side edges, clipped by its corners; every aspect and fit, absence, loading, groundTone, a tile grid. */
export const BleedPosters: Story = {
    render: () => (
        <Matrix maxWidth={1000}>
            <State label="every aspect, fit cover and contain" direction="column">
                <div data-story-bleed="aspects">
                    <G.Grid kind="cards" size="tile" columns={3} gap="inline">
                        {BLEED_ASPECTS.flatMap((aspect) => (["cover", "contain"] as const).map((fit) => (
                            <G.SurfaceCard key={`${aspect}-${fit}`} kind="tile" {...bleedTile(`${aspect} ${fit}`, { image: { src: placeholderImage(aspect), alt: aspect }, aspect, fit })} />
                        )))}
                    </G.Grid>
                </div>
            </State>
            <State label="absence, loading and groundTone" direction="column">
                <div data-story-bleed="states">
                    <G.Grid kind="cards" size="tile" columns={3} gap="inline">
                        <G.SurfaceCard kind="tile" {...bleedTile("No picture", { absence: "No picture" })} />
                        <G.SurfaceCard kind="tile" {...bleedTile("Loading", { absence: "No picture" })} isLoading />
                        <G.SurfaceCard kind="tile" {...bleedTile("Sold out", { image: { src: placeholderImage("Sold out"), alt: "Sold out" }, aspect: "square" }, { groundTone: "danger" })} />
                    </G.Grid>
                </div>
            </State>
        </Matrix>
    ),
    play: async ({ canvasElement }) => {
        const frames = [...canvasElement.querySelectorAll<HTMLElement>('[data-grammar-tile-poster-bleed="true"]')]
        await expect(frames).toHaveLength(9)
        for (const frame of frames) {
            const surface = frame.closest<HTMLElement>(".starci-core-surface")
            if (surface === null) throw new Error("A poster stands inside a card surface")
            const edge = surface.getBoundingClientRect()
            const box = frame.getBoundingClientRect()
            const border = Number.parseFloat(getComputedStyle(surface).borderTopWidth)
            // Flush to the top and both side edges, inside the border; clipped by the card.
            await expect(Math.abs(box.top - edge.top - border)).toBeLessThanOrEqual(1)
            await expect(Math.abs(box.left - edge.left - border)).toBeLessThanOrEqual(1)
            await expect(Math.abs(edge.right - border - box.right)).toBeLessThanOrEqual(1)
            await expect(getComputedStyle(surface).overflow).toBe("clip")
            // The copy below keeps the card's padding.
            const copy = surface.querySelector<HTMLElement>(".starci-core-tile-copy")
            if (copy === null) throw new Error("A tile has its copy")
            await expect(copy.getBoundingClientRect().left - edge.left).toBeGreaterThan(border + 8)
            await expect(copy.getBoundingClientRect().top).toBeGreaterThanOrEqual(box.bottom - 1)
        }
        await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
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
