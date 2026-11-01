import type { Meta, StoryObj } from "@storybook/react-vite"
import * as G from "../common/index.js"
import { Matrix, State, noop, placeholderImage } from "./fixtures.js"

const meta: Meta = { title: "Primitives/Media and drag" }
export default meta
type Story = StoryObj

/** A drag source in every state its caller can mark; the button inside is the keyboard route to the same act. */
export const DragItemStates: Story = {
    render: () => (
        <Matrix maxWidth={420}>
            <State label="Resting, selected, invalid, dashed, disabled" direction="column">
                <G.DragItem onDragStart={noop}><G.Button intent="neutral">Move lesson up</G.Button></G.DragItem>
                <G.DragItem isSelected onDragStart={noop}><G.Button intent="neutral">Selected lesson</G.Button></G.DragItem>
                <G.DragItem isInvalid onDragStart={noop}><G.Button intent="neutral">Invalid placement</G.Button></G.DragItem>
                <G.DragItem isDashed onDragStart={noop}><G.Button intent="neutral">Drop target</G.Button></G.DragItem>
                <G.DragItem isDisabled><G.Button intent="neutral" isDisabled>Locked lesson</G.Button></G.DragItem>
                <G.DragItem leadingColor="#7547ff" onDragStart={noop}><G.Button intent="neutral">With a category colour</G.Button></G.DragItem>
            </State>
        </Matrix>
    ),
}

/** The player with a poster and no caption resource (never a placeholder track), in its reserved frame. */
export const VideoPoster: Story = {
    render: () => (
        <Matrix maxWidth={480}>
            <State label="Poster, no captions" direction="column">
                <G.MediaFrame aspect="landscape"><G.Video src="" title="Lesson preview" poster={placeholderImage("Preview")} captions={null} /></G.MediaFrame>
            </State>
        </Matrix>
    ),
}
