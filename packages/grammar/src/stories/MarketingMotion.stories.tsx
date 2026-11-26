import type { Meta, StoryObj } from "@storybook/react-vite"
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
}
