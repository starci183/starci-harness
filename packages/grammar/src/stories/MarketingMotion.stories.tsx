import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor, within } from "storybook/test"
import * as G from "../common/index.js"
import type { TileData } from "../core/surfaceCardData.js"
import { Matrix, State, noop, placeholderImage } from "./fixtures.js"

const meta: Meta = { title: "Marketing/Motion" }
export default meta
type Story = StoryObj

/** The motion tokens every piece reads, by name; the family root resolves each (Offset Pop overrides some). */
const TOKENS = [
    "--grammar-motion-ease-out",
    "--grammar-motion-ease-in-out",
    "--grammar-motion-duration-base",
    "--grammar-motion-duration-reveal",
    "--grammar-motion-duration-count",
    "--grammar-motion-stagger",
    "--grammar-motion-distance-reveal",
    "--grammar-motion-distance-step",
    "--grammar-loop-marquee",
    "--grammar-loop-marquee-compact",
    "--grammar-story-pin-top",
    "--grammar-story-height",
] as const

const TokenRow = ({ name }: { readonly name: string }) => (
    <div data-story-token={name} style={{ display: "flex", gap: "var(--grammar-row-gap)", justifyContent: "space-between" }}>
        <G.Code>{name}</G.Code>
        <span data-story-token-value="true" />
    </div>
)

/** Durations, easing and distances of the marketing pieces, resolved on the family root (both families, light and dark). */
export const Tokens: Story = {
    render: () => (
        <Matrix maxWidth={640}>
            <State label="Resolved on the family root" direction="column">
                {TOKENS.map((name) => <TokenRow key={name} name={name} />)}
            </State>
        </Matrix>
    ),
    play: async ({ canvasElement }) => {
        const root = canvasElement.closest<HTMLElement>(".grammar-common-root") ?? canvasElement
        const style = getComputedStyle(root)
        for (const name of TOKENS) {
            const value = style.getPropertyValue(name).trim()
            await expect(value).not.toBe("")
            const cell = canvasElement.querySelector<HTMLElement>(`[data-story-token="${name}"] [data-story-token-value]`)
            if (cell !== null) cell.textContent = value
        }
        await expect(style.getPropertyValue("--grammar-motion-ease-out")).toContain("cubic-bezier")
    },
}

const Block = ({ label }: { readonly label: string }) => (
    <G.SurfaceCard>
        <G.Heading level={3}>{label}</G.Heading>
        <G.Text>One short line that says what this piece of the page is for.</G.Text>
    </G.SurfaceCard>
)

/** A region fades up as it enters the viewport; here it is already on screen, so it stands complete. */
export const RevealRise: Story = {
    render: () => (
        <Matrix maxWidth={960}>
            <G.Reveal><Block label="Rises as one piece" /></G.Reveal>
            <G.Reveal kind="stagger">
                <G.Grid kind="cards" columns={3}>
                    <Block label="First" />
                    <Block label="Second" />
                    <Block label="Third" />
                </G.Grid>
            </G.Reveal>
        </Matrix>
    ),
    play: async ({ canvasElement }) => {
        const reveals = canvasElement.querySelectorAll<HTMLElement>('[data-component="Reveal"]')
        await expect(reveals).toHaveLength(2)
        await expect(reveals[0]?.getAttribute("data-grammar-reveal-kind")).toBe("rise")
        await expect(reveals[1]?.getAttribute("data-grammar-reveal-kind")).toBe("stagger")
        // Visible by default: whatever the browser supports, content on screen is complete and in place.
        await waitFor(() => {
            for (const piece of canvasElement.querySelectorAll<HTMLElement>('[data-component="Reveal"][data-grammar-reveal-kind="rise"], [data-component="Reveal"][data-grammar-reveal-kind="stagger"] > *')) {
                expect(Number.parseFloat(getComputedStyle(piece).opacity)).toBe(1)
            }
        })
    },
}

/** A region below the fold: it rises when scrolled to. A tall spacer holds it under the first screen. */
export const RevealBelowTheFold: Story = {
    render: () => (
        <div>
            <div style={{ height: "120vh" }} aria-hidden="true" />
            <G.Reveal kind="stagger">
                <G.Grid kind="cards" columns={3}>
                    <Block label="First" />
                    <Block label="Second" />
                    <Block label="Third" />
                </G.Grid>
            </G.Reveal>
            <div style={{ height: "40vh" }} aria-hidden="true" />
        </div>
    ),
    parameters: { grammar: { minHeight: "200vh" } },
    play: async ({ canvasElement }) => {
        const reveal = canvasElement.querySelector<HTMLElement>('[data-component="Reveal"]')
        if (reveal === null) throw new Error("A Reveal stands in the story")
        reveal.scrollIntoView({ block: "center" })
        await waitFor(() => {
            for (const child of Array.from(reveal.children)) expect(Number.parseFloat(getComputedStyle(child).opacity)).toBe(1)
        }, { timeout: 4000 })
    },
}

const LOGOS = ["Hoa Mộc Spa", "Bếp Nhà", "Lotus Dental", "Tiệm Cà Phê Sáu", "An Phát Logistics", "Sao Mai Studio", "Minh Long Auto"] as const

/** An endless strip of names: it drifts, pauses under the pointer or focus, and repeats its content aria-hidden and inert. */
export const MarqueeLogos: Story = {
    render: () => (
        <Matrix maxWidth={960}>
            <State label="Names" direction="column">
                <G.Marquee label="Trusted by small businesses">
                    {LOGOS.map((name) => <G.Badge key={name} tone="neutral">{name}</G.Badge>)}
                </G.Marquee>
            </State>
            <State label="With links (the copy stays out of the tab order)" direction="column">
                <G.Marquee label="Customer stories">
                    {LOGOS.slice(0, 4).map((name) => <G.Link key={name} href={`#${encodeURIComponent(name)}`}>{name}</G.Link>)}
                </G.Marquee>
            </State>
        </Matrix>
    ),
    play: async ({ canvasElement }) => {
        const strips = canvasElement.querySelectorAll<HTMLElement>('[data-component="Marquee"]')
        await expect(strips).toHaveLength(2)
        for (const strip of strips) {
            const source = strip.querySelector('[data-grammar-marquee-run="source"]')
            const copy = strip.querySelector<HTMLElement>('[data-grammar-marquee-run="copy"]')
            if (source === null || copy === null) throw new Error("A strip has its run and its copy")
            await expect(copy.getAttribute("aria-hidden")).toBe("true")
            await expect(copy.hasAttribute("inert")).toBe(true)
            await expect(copy.children).toHaveLength(source.children.length)
            await expect(strip.getAttribute("role")).toBe("group")
        }
        // The keyboard meets each link once: the copy holds none that can take focus.
        await expect(within(strips[1] as HTMLElement).getAllByRole("link")).toHaveLength(4)
        await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
    },
}

/** A figure counts up when seen; its final value is real text from the first byte. */
export const CountUpFigures: Story = {
    render: () => (
        <Matrix maxWidth={960}>
            <G.Grid kind="cards" columns={3}>
                <G.SurfaceCard>
                    <span data-story-figure="whole" style={{ fontSize: "var(--grammar-text-5xl)", fontWeight: 700 }}><G.CountUp value={12400} locale="en" suffix="+" /></span>
                    <G.Text tone="muted">Teams on the waiting list</G.Text>
                </G.SurfaceCard>
                <G.SurfaceCard>
                    <span data-story-figure="percent" style={{ fontSize: "var(--grammar-text-5xl)", fontWeight: 700 }}><G.CountUp value={0.98} locale="en" format={{ style: "percent" }} /></span>
                    <G.Text tone="muted">Requests answered in a minute</G.Text>
                </G.SurfaceCard>
                <G.SurfaceCard>
                    <span data-story-figure="decimal" style={{ fontSize: "var(--grammar-text-5xl)", fontWeight: 700 }}><G.CountUp value={4.8} locale="vi" format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} prefix="★ " /></span>
                    <G.Text tone="muted">Average rating</G.Text>
                </G.SurfaceCard>
            </G.Grid>
        </Matrix>
    ),
    play: async ({ canvasElement }) => {
        const figures = canvasElement.querySelectorAll<HTMLElement>('[data-component="CountUp"]')
        await expect(figures).toHaveLength(3)
        // The count ends, in every browser and every motion setting, on the final value as real text.
        await waitFor(() => {
            for (const figure of figures) expect(figure.getAttribute("data-grammar-count-state")).toBe("done")
        }, { timeout: 4000 })
        await expect(figures[0]?.textContent).toBe("12,400+")
        await expect(figures[1]?.textContent).toBe("98%")
        await expect(figures[2]?.textContent).toBe("★ 4,8")
        // While it counts the moving figure is hidden from assistive technology; at rest there is no hidden twin.
        await expect(canvasElement.querySelectorAll('[data-component="CountUp"] [aria-hidden="true"]')).toHaveLength(0)
    },
}

const STORY_STEPS = ["Ask", "Plan", "Approve", "Done"] as const

const storySteps = () => STORY_STEPS.map((name, index) => ({
    id: name.toLowerCase(),
    content: (
        <G.Stack gap="row">
            <G.Heading level={3}>{`${index + 1}. ${name}`}</G.Heading>
            <G.Text>The text of the step stays in reading order; its picture stands beside it while it passes.</G.Text>
        </G.Stack>
    ),
    panel: <G.Image src={placeholderImage(name, 330 + index * 40)} alt={`${name} view of the product`} ratio="4:3" />,
})) as unknown as readonly [G.StickyStoryStep, G.StickyStoryStep, ...G.StickyStoryStep[]]

/** A pinned stage whose picture follows the text. On a phone and under reduced motion each step shows its own panel below its text. */
export const StickyStorySteps: Story = {
    render: () => (
        <div style={{ paddingBlock: "var(--grammar-region-gap)" }}>
            <G.StickyStory label="How a request travels" steps={storySteps()} />
        </div>
    ),
    parameters: { grammar: { minHeight: "160vh" } },
    play: async ({ canvasElement }) => {
        const story = canvasElement.querySelector<HTMLElement>('[data-component="StickyStory"]')
        if (story === null) throw new Error("A StickyStory stands in the story")
        const steps = story.querySelectorAll<HTMLElement>("[data-grammar-story-step]")
        await expect(steps).toHaveLength(STORY_STEPS.length)
        // The steps are one ordered list; the pinned stage is a decorative twin, hidden from assistive technology and the keyboard.
        await expect(within(story).getAllByRole("listitem")).toHaveLength(STORY_STEPS.length)
        const pin = story.querySelector<HTMLElement>(".starci-core-story-pin")
        await expect(pin?.getAttribute("aria-hidden")).toBe("true")
        await expect(pin?.hasAttribute("inert")).toBe(true)
        await expect(story.querySelectorAll(".starci-core-story-panel")).toHaveLength(STORY_STEPS.length)
        await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
    },
}

/** The stage on the start side. */
export const StickyStoryStageStart: Story = {
    render: () => <G.StickyStory label="How a request travels" steps={storySteps()} stage="start" />,
    parameters: { grammar: { minHeight: "160vh" } },
}

const marketingTile = (name: string, hue: number): TileData => ({
    name,
    poster: { image: { src: placeholderImage(name, hue), alt: name }, aspect: "landscape", fit: "cover", bleed: true },
    badges: [{ label: "Available", tone: "success" }],
    facts: "A line that says what it is for.",
    action: { label: `Open ${name}`, press: noop },
} as TileData)

/** The image-cover card for marketing is the tile with `poster.bleed`, inside a staggered Reveal: no further card is needed. */
export const CoverCardsReveal: Story = {
    render: () => (
        <Matrix maxWidth={960}>
            <G.Reveal kind="stagger">
                <G.Grid kind="cards" size="tile" columns={3} gap="inline">
                    <G.SurfaceCard kind="tile" {...marketingTile("Booking", 330)} />
                    <G.SurfaceCard kind="tile" {...marketingTile("Reminders", 200)} />
                    <G.SurfaceCard kind="tile" {...marketingTile("Reports", 120)} />
                </G.Grid>
            </G.Reveal>
        </Matrix>
    ),
    play: async ({ canvasElement }) => {
        await expect(canvasElement.querySelectorAll('[data-grammar-tile-poster-bleed="true"]')).toHaveLength(3)
    },
}
