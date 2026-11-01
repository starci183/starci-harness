import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { expect, userEvent, within } from "storybook/test"
import * as G from "../common/index.js"
import { BellGlyph, BookGlyph, Matrix, State, noop } from "./fixtures.js"

const meta: Meta = { title: "States/Button group" }
export default meta
type Story = StoryObj

const PendingGroups = () => {
    const [opened, setOpened] = useState(0)
    return (
        <Matrix>
            <State label="Only the initiating text action is pending">
                <G.ButtonGroup label="Gateway actions" size="sm" actions={[
                    { id: "sync", label: "Sync", isPending: true, onPress: noop },
                    { id: "open", label: "Open gateway", onPress: () => setOpened((count) => count + 1) },
                    { id: "restricted", label: "Restricted action", isDisabled: true, onPress: noop },
                ]} />
                <span role="status">Opened: {opened}</span>
            </State>
            <State label="Only the initiating icon action is pending">
                <G.ButtonGroup label="Icon actions" size="sm" actions={[
                    { id: "refresh", label: "Refresh", source: BellGlyph, isPending: true, onPress: noop },
                    { id: "read", label: "Read details", source: BookGlyph, onPress: noop },
                ]} />
            </State>
        </Matrix>
    )
}

export const ActionPending: Story = {
    render: () => <PendingGroups />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const textGroup = within(canvas.getByRole("group", { name: "Gateway actions" }))
        await expect(textGroup.getByRole("button", { name: "Sync" })).toBeDisabled()
        await expect(textGroup.getByRole("button", { name: "Restricted action" })).toBeDisabled()
        await expect(textGroup.getByRole("button", { name: "Open gateway" })).toBeEnabled()
        await userEvent.click(textGroup.getByRole("button", { name: "Open gateway" }))
        await expect(canvas.getByRole("status")).toHaveTextContent("Opened: 1")
        const icons = within(canvas.getByRole("group", { name: "Icon actions" }))
        await expect(icons.getByRole("button", { name: "Refresh" })).toBeDisabled()
        await expect(icons.getByRole("button", { name: "Refresh" })).toHaveAttribute("aria-busy", "true")
        await expect(icons.getByRole("button", { name: "Read details" })).toBeEnabled()
        const pending = icons.getByRole("button", { name: "Refresh" })
        const peer = icons.getByRole("button", { name: "Read details" })
        await expect(Number.parseFloat(getComputedStyle(pending).borderStartEndRadius)).toBe(0)
        await expect(Number.parseFloat(getComputedStyle(peer).borderStartStartRadius)).toBe(0)
        await expect(peer.getBoundingClientRect().left).toBeCloseTo(pending.getBoundingClientRect().right, 0)
    },
}

const unresolvedActions: readonly G.ButtonGroupAction[] = [
    { id: "sync", label: "Sync gateway", onPress: noop },
    { id: "read", label: "Read details", source: BookGlyph, onPress: noop },
]

export const InitialLoading: Story = {
    render: () => (
        <Matrix>
            <State label="Ready"><G.ButtonGroup label="Ready actions" size="sm" actions={unresolvedActions} /></State>
            <State label="Loading"><G.ButtonGroup label="Loading actions" size="sm" actions={unresolvedActions} isLoading /></State>
            <State label="Whole group disabled"><G.ButtonGroup label="Unavailable actions" size="sm" actions={unresolvedActions} isDisabled /></State>
            <State label="Inherited loading" direction="column"><G.Section title="Gateway" isLoading><G.ButtonGroup label="Inherited actions" size="sm" actions={unresolvedActions} /></G.Section></State>
        </Matrix>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const ready = canvas.getByRole("group", { name: "Ready actions" })
        const loading = canvas.getByRole("group", { name: "Loading actions" })
        await expect(loading).toHaveAttribute("aria-busy", "true")
        await expect(within(loading).queryByRole("button")).not.toBeInTheDocument()
        for (const control of loading.querySelectorAll("button")) await expect(control).toBeDisabled()
        await expect(loading.getBoundingClientRect().width).toBeCloseTo(ready.getBoundingClientRect().width, 0)
        await expect(loading.getBoundingClientRect().height).toBeCloseTo(ready.getBoundingClientRect().height, 0)
        for (const group of [ready, loading]) {
            const members = group.querySelectorAll("button")
            const first = members.item(0)
            const second = members.item(1)
            if (first === null || second === null) throw new Error("The group must render both native member roots")
            await expect(Number.parseFloat(getComputedStyle(first).borderStartEndRadius)).toBe(0)
            await expect(Number.parseFloat(getComputedStyle(second).borderStartStartRadius)).toBe(0)
            await expect(second.getBoundingClientRect().left).toBeCloseTo(first.getBoundingClientRect().right, 0)
        }
        await expect(canvas.getByRole("group", { name: "Inherited actions" })).toHaveAttribute("aria-busy", "true")
    },
}
