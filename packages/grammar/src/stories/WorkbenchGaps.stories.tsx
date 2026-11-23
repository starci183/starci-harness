import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { expect, userEvent, waitFor, within } from "storybook/test"
import * as G from "../common/index.js"
import type { TileGroundTone } from "../core/surfaceCardData.js"
import { Matrix, State } from "./fixtures.js"
import { TablerCalendar, TablerFilter } from "../core/leaf/Icon/tabler.js"

/**
 * WORKBENCH GAPS (0.47.1). Six gaps a screen critique of a working surface (a floor plan, a product grid, a filtered list) found, each answered by a field of an existing
 * component: `Grid kind="cards" size="tile"`, `SurfaceCard kind="tile"` (`groundTone`, no mark, rows that keep their height), `TagGroup` `onClearAll`,
 * `Select` `icon` and `SearchField` `measure="toolbar"`. Both families, light and dark, at 1920 and 390 (the DNA setup).
 */
const meta: Meta = { title: "Layouts/Workbench gaps (0.47.1)", parameters: { layout: "padded" } }
export default meta
type Story = StoryObj

const boxOf = (root: ParentNode, selector: string): HTMLElement => {
  const found = root.querySelector<HTMLElement>(selector)
  if (found === null) throw new Error(`no element for ${selector}`)
  return found
}

const TILES = ["Margherita", "Pepperoni", "Funghi", "Quattro", "Diavola", "Capricciosa"]

/** Small product tiles: the track floor is 9rem, so two stand side by side at 390 and as many as the width holds (capped by `columns`) on a wide page. */
export const TileGridTwoColumns: Story = {
  render: () => (
    <Matrix maxWidth={1200}>
      <State label="size=tile, columns=4" direction="column">
        <div data-story-grid="tile">
          <G.Grid kind="cards" size="tile" columns={4} gap="inline">
            {TILES.map((name) => <G.SurfaceCard key={name} kind="tile" name={name} facts="120.000 d" action={{ label: "Add", press: () => undefined }} />)}
          </G.Grid>
        </div>
      </State>
      <State label="the default floor (16rem): one column on a phone" direction="column">
        <div data-story-grid="card">
          <G.Grid kind="cards" columns={4} gap="inline">
            {TILES.slice(0, 4).map((name) => <G.SurfaceCard key={name} kind="tile" name={name} facts="120.000 d" action={{ label: "Add", press: () => undefined }} />)}
          </G.Grid>
        </div>
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const grid = boxOf(canvasElement, '[data-story-grid="tile"] [data-grammar-grid-size="tile"]')
      const tiles = [...grid.querySelectorAll<HTMLElement>(":scope > [data-grammar-surface-card]")]
      expect(tiles).toHaveLength(6)
      const lefts = new Set(tiles.map((tile) => Math.round(tile.getBoundingClientRect().left)))
      // A phone holds exactly two columns; a wide page holds the cap of four.
      expect(lefts.size).toBe(window.innerWidth < 480 ? 2 : 4)
      for (const tile of tiles) {
        const box = tile.getBoundingClientRect()
        expect(box.width).toBeGreaterThanOrEqual(144 - 1)
        // The touch target of the action keeps its floor inside the narrow track.
        const action = tile.querySelector<HTMLElement>('[data-component="Button"]')
        if (action !== null) expect(action.getBoundingClientRect().height).toBeGreaterThanOrEqual(32)
        expect(box.right).toBeLessThanOrEqual(grid.getBoundingClientRect().right + 1)
      }
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
      const plain = boxOf(canvasElement, '[data-story-grid="card"] [data-grammar-grid-size="card"]')
      const plainLefts = new Set([...plain.querySelectorAll<HTMLElement>(":scope > [data-grammar-surface-card]")].map((tile) => Math.round(tile.getBoundingClientRect().left)))
      if (window.innerWidth < 480) expect(plainLefts.size).toBe(1)
    }, { timeout: 4000 })
  },
}

const TONES: ReadonlyArray<{ readonly tone: TileGroundTone | undefined; readonly name: string; readonly status: string }> = [
  { tone: undefined, name: "Table 1", status: "Free" },
  { tone: "success", name: "Table 2", status: "Seated" },
  { tone: "warning", name: "Table 3", status: "Bill asked" },
  { tone: "danger", name: "Table 4", status: "Late order" },
  { tone: "accent", name: "Table 5", status: "Reserved" },
]

/** A floor plan: tiles with no mark, each tinted by status; the badge still says the status in words. */
export const TileGroundAndBare: Story = {
  render: () => (
    <Matrix maxWidth={1000}>
      <State label="groundTone on bare tiles (no mark, no poster)" direction="column">
        <div data-story-grid="floor">
          <G.Grid kind="cards" size="tile" columns={5} gap="inline">
            {TONES.map((table) => (
              <G.SurfaceCard key={table.name} kind="tile" name={table.name} badge={{ label: table.status, tone: table.tone ?? "neutral" }} facts="4 seats" {...(table.tone === undefined ? {} : { groundTone: table.tone })} />
            ))}
          </G.Grid>
        </div>
      </State>
      <State label="a marked tile shorter than its row keeps its rows at the top" direction="column">
        <div data-story-grid="rows">
          <G.Grid kind="cards" size="tile" columns={2} gap="inline">
            <G.SurfaceCard kind="tile" name="Short" mark={{ icon: TablerFilter }} byline="One line" groundTone="success" badge={{ label: "Open", tone: "success" }} />
            <G.SurfaceCard kind="tile" name="Taller neighbour" mark={{ icon: TablerCalendar }} byline="Version 2" description="A description that runs over several lines so that this tile sets the height of the row for its short neighbour on the left." facts={["Updated today", "3 members"]} />
          </G.Grid>
        </div>
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const floor = boxOf(canvasElement, '[data-story-grid="floor"]')
      const surfaces = [...floor.querySelectorAll<HTMLElement>('.starci-core-surface[data-grammar-surface-kind="tile"]')]
      expect(surfaces).toHaveLength(5)
      expect(floor.querySelector("[data-grammar-tile-mark]")).toBeNull()
      const probe = document.createElement("span")
      floor.append(probe)
      try {
        const paint = (token: string) => {
          probe.style.background = `var(${token})`
          return getComputedStyle(probe).backgroundColor
        }
        const plain = surfaces[0]
        expect(plain?.getAttribute("data-grammar-surface-ground")).toBeNull()
        surfaces.slice(1).forEach((surface, index) => {
          const tone = TONES[index + 1]?.tone
          expect(surface.getAttribute("data-grammar-surface-ground")).toBe(tone)
          expect(getComputedStyle(surface).backgroundColor).toBe(paint(`--${tone}-soft`))
          probe.style.color = `var(--${tone}-soft-foreground)`
          expect(getComputedStyle(surface).color).toBe(getComputedStyle(probe).color)
        })
      } finally {
        probe.remove()
      }
      const rows = boxOf(canvasElement, '[data-story-grid="rows"]')
      const short = boxOf(rows, '.starci-core-surface[data-grammar-surface-kind="tile"][data-grammar-surface-ground]')
      const tile = boxOf(short, '[data-grammar-tile="true"]')
      expect(getComputedStyle(tile).alignContent).toBe("start")
      // The name row is not pushed down: the first row of the grid starts at the top of the tile.
      const mark = boxOf(tile, "[data-grammar-tile-mark]")
      expect(Math.abs(mark.getBoundingClientRect().top - tile.getBoundingClientRect().top)).toBeLessThanOrEqual(1)
      const tall = [...rows.querySelectorAll<HTMLElement>('.starci-core-surface[data-grammar-surface-kind="tile"]')][1]
      expect(tall?.getBoundingClientRect().height).toBeCloseTo(short.getBoundingClientRect().height, 0)
    }, { timeout: 4000 })
  },
}

const CRITERIA: ReadonlyArray<G.TagGroupItem> = [
  { id: "status", label: "Status: Open" },
  { id: "owner", label: "Owner: Mai Phuong" },
  { id: "period", label: "This week" },
  { id: "tag", label: "Tag: Priority" },
]

const ActiveFilters = ({ width }: { readonly width?: number }) => {
  const [items, setItems] = useState(CRITERIA)
  return (
    <div style={width === undefined ? undefined : { maxInlineSize: width }}>
      <G.TagGroup
        label="Active filters"
        items={items}
        onRemove={(ids) => setItems((current) => current.filter((item) => !ids.includes(item.id)))}
        removeLabel={(label) => `Remove ${label}`}
        onClearAll={() => setItems([])}
        clearAllLabel="Clear all"
        emptyContent="No filters"
      />
    </div>
  )
}

/** The values a toolbar applied, each removable, with "Clear all" after the last chip; the action leaves with the last chip. */
export const ActiveFilterValues: Story = {
  render: () => (
    <Matrix maxWidth={760}>
      <State label="wide" direction="column"><div data-story-filters="wide"><ActiveFilters /></div></State>
      <State label="narrow (wraps; Clear all drops under the chips)" direction="column"><div data-story-filters="narrow"><ActiveFilters width={260} /></div></State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    const wide = boxOf(canvasElement, '[data-story-filters="wide"]')
    await waitFor(() => expect(within(wide).getAllByRole("row")).toHaveLength(4), { timeout: 4000 })
    const clear = within(wide).getByRole("button", { name: "Clear all" })
    // After the last chip on the same line when the row is wide enough.
    const lastChip = [...wide.querySelectorAll<HTMLElement>("[data-grammar-tag]")].at(-1)
    if (window.innerWidth >= 768) expect(clear.getBoundingClientRect().left).toBeGreaterThanOrEqual((lastChip?.getBoundingClientRect().right ?? 0) - 1)
    const narrow = boxOf(canvasElement, '[data-story-filters="narrow"]')
    expect(narrow.scrollWidth).toBeLessThanOrEqual(narrow.clientWidth + 1)
    await userEvent.click(boxOf(wide, "[data-grammar-tag-id=\"status\"] [data-grammar-tag-remove]"))
    await waitFor(() => expect(within(wide).getAllByRole("row")).toHaveLength(3))
    await userEvent.click(within(wide).getByRole("button", { name: "Clear all" }))
    await waitFor(() => expect(within(wide).queryByRole("button", { name: "Clear all" })).toBeNull())
    expect(wide.querySelector("[data-grammar-tag-empty]")).not.toBeNull()
  },
}

/** A Select with a glyph at the start of its trigger, in the field, pill and compact appearances; with a prefix the glyph stands before it. */
export const SelectWithIcon: Story = {
  render: () => (
    <Matrix maxWidth={360}>
      <State label="field" direction="column"><G.Select label="Period" icon={TablerCalendar} options={[{ id: "week", label: "This week" }, { id: "month", label: "This month" }]} defaultValue="week" /></State>
      <State label="pill with a prefix" direction="column"><G.Select label="Status" appearance="pill" icon={TablerFilter} prefix="Status:" options={[{ id: "open", label: "Open" }, { id: "done", label: "Done" }]} defaultValue="open" /></State>
      <State label="compact" direction="column"><G.Select label="Period" appearance="compact" icon={TablerCalendar} options={[{ id: "week", label: "This week" }, { id: "month", label: "This month" }]} defaultValue="month" /></State>
      <State label="loading (same box)" direction="column"><G.Select label="Period" appearance="compact" icon={TablerCalendar} options={[{ id: "week", label: "This week" }]} defaultValue="week" isLoading /></State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const icons = [...canvasElement.querySelectorAll<HTMLElement>("[data-grammar-select-icon]")]
      expect(icons).toHaveLength(4)
      for (const mark of icons) {
        expect(mark.getAttribute("aria-hidden")).toBe("true")
        const trigger = mark.closest<HTMLElement>(".starci-core-select-trigger")
        const value = trigger?.querySelector<HTMLElement>(".select__value")
        if (trigger === null || trigger === undefined || value === null || value === undefined) throw new Error("the glyph stands in a trigger")
        // The glyph is a 16px box at the start of the trigger, before the value.
        const glyph = mark.querySelector<HTMLElement>("svg")?.getBoundingClientRect()
        expect(glyph?.width).toBe(16)
        expect(mark.getBoundingClientRect().right).toBeLessThanOrEqual(value.getBoundingClientRect().left + 1)
        expect(mark.getBoundingClientRect().left).toBeLessThan(trigger.getBoundingClientRect().left + 40)
      }
    }, { timeout: 4000 })
    const compact = boxOf(canvasElement, '[data-grammar-select-appearance="compact"] .starci-core-select-trigger')
    expect(compact.getBoundingClientRect().height).toBe(32)
  },
}

/** A toolbar: a picker and a 240px search field in one row; the search fills the row below 30rem (a phone). */
export const ToolbarSearch: Story = {
  render: () => (
    <Matrix maxWidth={900}>
      <State label="measure=toolbar beside a picker" direction="column">
        <div data-story-toolbar="true">
          <G.Cluster gap="inline" align="end">
            <G.SearchField label="Search orders" measure="toolbar" placeholder="Search" />
            <G.Select label="Period" appearance="compact" icon={TablerCalendar} options={[{ id: "week", label: "This week" }, { id: "month", label: "This month" }]} defaultValue="week" />
          </G.Cluster>
        </div>
      </State>
      <State label="compact (26rem) for comparison" direction="column"><G.SearchField label="Search all orders" measure="compact" placeholder="Search" /></State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const search = boxOf(canvasElement, '[data-story-toolbar="true"] [data-grammar-search-measure="toolbar"]')
      const width = search.getBoundingClientRect().width
      if (window.innerWidth >= 480) expect(width).toBe(240)
      else expect(width).toBeGreaterThan(240)
      const compact = boxOf(canvasElement, '[data-grammar-search-measure="compact"]')
      if (window.innerWidth >= 480) expect(compact.getBoundingClientRect().width).toBeGreaterThan(width)
    }, { timeout: 4000 })
  },
}
