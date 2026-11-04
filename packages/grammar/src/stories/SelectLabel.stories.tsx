import type { Meta, StoryObj } from "@storybook/react-vite"
import * as G from "../common/index.js"
import { Matrix, State, UploadGlyph } from "./fixtures.js"

/*
 * A row picker whose label is the row's own words (a level per connection): `isLabelHidden` keeps the label as the accessible name and
 * draws only the control, in the ready and in the loading state alike (same box).
 */

const meta: Meta = { title: "Forms/Select hidden label" }
export default meta
type Story = StoryObj

const options = [{ id: "all", label: "Everything" }, { id: "read", label: "Read only" }, { id: "none", label: "Nothing" }]

export const SelectHiddenLabel: Story = {
    render: () => (
        <Matrix maxWidth={320}>
            <State label="Visible label (the default)" direction="column"><G.Select label="Level" options={options} defaultValue="read" /></State>
            <State label="isLabelHidden: the label names the control and is not drawn" direction="column"><G.Select label="Level for Telegram" isLabelHidden options={options} defaultValue="read" /></State>
            <State label="isLabelHidden, loading (same box)" direction="column"><G.Select label="Level for Telegram" isLabelHidden options={options} defaultValue="read" isLoading /></State>
        </Matrix>
    ),
}

const FileCard = ({ isLoading }: { readonly isLoading?: boolean }) => (
    <G.SurfaceCard label="Profile picture" {...(isLoading === undefined ? {} : { isLoading })}>
        <G.FileDropzone label="Picture" prompt="Drop a picture or choose one" description="PNG, JPEG or WebP." accept="image/*" />
        <G.FileButton label="Change picture" source={UploadGlyph} onFilesChange={() => undefined} />
    </G.SurfaceCard>
)

export const FileControlsLoading: Story = {
    render: () => (
        <Matrix maxWidth={420}>
            <State label="Ready" direction="column"><FileCard /></State>
            <State label="Loading (the card's flag reaches both controls: same boxes, labels real)" direction="column"><FileCard isLoading /></State>
            <State label="Own flag" direction="column">
                <G.FileDropzone label="Picture" prompt="Drop a picture or choose one" isLoading />
                <G.FileButton label="Change picture" source={UploadGlyph} onFilesChange={() => undefined} isLoading />
            </State>
        </Matrix>
    ),
}
