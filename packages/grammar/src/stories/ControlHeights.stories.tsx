import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { expect, waitFor } from "storybook/test"
import * as G from "../common/index.js"
import { BellGlyph, Matrix, SearchGlyph, SettingsGlyph, StarGlyph, State, familyScope, noop } from "./fixtures.js"

const meta: Meta = { title: "Primitives/Control heights" }
export default meta
type Story = StoryObj

const tabItems = [
    { id: "all", label: "All" },
    { id: "unread", label: "Unread" },
    { id: "mine", label: "Mine" },
]

const segmentOptions = [
    { value: "day", label: "Day" },
    { value: "week", label: "Week" },
]

const planOptions = [
    { id: "starter", label: "Starter" },
    { id: "team", label: "Team" },
]

/** One row, every standalone control at its default: all of them draw the one 40px control height. */
const ControlRow = () => {
    const [tab, setTab] = useState("all")
    return (
        <div data-story-control-row="true" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem" }}>
            <G.Button intent="commit">Save</G.Button>
            <G.Button intent="dismiss">Cancel</G.Button>
            <G.IconButton intent="dismiss" source={BellGlyph} label="Notifications" />
            <G.IconButton intent="dismiss" source={SettingsGlyph} label="Settings" size="control" />
            <G.Input id="control-heights-name" name="name" label="Name" isLabelHidden placeholder="Name" />
            <G.SearchField label="Search" isLabelHidden placeholder="Search" clearLabel="Clear search" />
            <G.Select label="Plan" isLabelHidden options={planOptions} defaultValue="starter" />
            <G.Tabs label="Filter" variant="secondary" items={tabItems} selectedKey={tab} onSelect={setTab} panelId={(key) => `control-heights-${key}`} labelVisibility="always" />
            <G.SegmentedControl label="Range" isLabelHidden options={segmentOptions} defaultValue="day" />
            <G.Switch label="Dark mode" isLabelHidden size="control" thumbIcon={SettingsGlyph} selectedThumbIcon={StarGlyph} />
            <G.AvatarButton name="Alex Morgan" size="control" />
            <G.Button intent="commit" startContent={<SearchGlyph />}>Send</G.Button>
        </div>
    )
}

/** The default height of every control in one row, light and dark, with the 40px each draws asserted. */
export const OneRowAllAtForty: Story = {
    render: (_, { globals }) => (
        <Matrix>
            {(["light", "dark"] as const).map((theme) => (
                <G.GrammarRoot key={theme} {...familyScope(globals)} theme={theme}>
                    <State label={`${theme}: Button, IconButton, Input, SearchField, Select, Tabs, SegmentedControl, Switch, Avatar, send Button`} direction="column">
                        <ControlRow />
                    </State>
                </G.GrammarRoot>
            ))}
        </Matrix>
    ),
    play: async ({ canvasElement }) => {
        await waitFor(() => {
            for (const row of canvasElement.querySelectorAll<HTMLElement>("[data-story-control-row]")) {
                for (const selector of ["[data-component=Button]", "[data-component=IconButton]", "[data-component=Switch] [data-grammar-choice-control=switch]"]) {
                    for (const control of row.querySelectorAll<HTMLElement>(selector)) expect(Math.round(control.getBoundingClientRect().height)).toBe(40)
                }
            }
        })
    },
}

/** The two other steps: `sm` (32px) for a control nested in an item or dense toolbar, `lg` (48px) for a landing hero call to action. */
export const NestedAndHeroSteps: Story = {
    render: () => (
        <Matrix>
            <State label="sm (32px): row actions inside an item, every control of the row at sm">
                <G.IconButton intent="dismiss" source={BellGlyph} label="Mute" size="sm" />
                <G.IconButton intent="dismiss" source={SettingsGlyph} label="Settings" size="sm" />
                <G.Button intent="neutral" size="sm" onPress={noop}>Details</G.Button>
            </State>
            <State label="lg (48px): the landing hero call to action">
                <G.Button intent="commit" size="lg" onPress={noop}>Start free</G.Button>
            </State>
        </Matrix>
    ),
}
