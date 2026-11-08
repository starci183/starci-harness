import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import * as G from "../common/index.js"
import { Matrix, State } from "./fixtures.js"

/*
 * Spotlight rings its target with the accent for the spotlight duration (3s), pulsing softly, then settles and calls `onEnd`.
 * AvatarButton `size="floating"` is the 56px launcher with an optional StatusDot badge at the top end corner.
 */

const meta: Meta = { title: "Navigation & Data/Spotlight" }
export default meta
type Story = StoryObj

const Replay = ({ shape = "rounded", isBlock = false }: { readonly shape?: G.SpotlightShape; readonly isBlock?: boolean }) => {
  const [isActive, setIsActive] = useState(true)
  const [ended, setEnded] = useState(0)
  return (
    <G.Cluster gap="inline">
      <G.Spotlight isActive={isActive} shape={shape} isBlock={isBlock} onEnd={() => { setIsActive(false); setEnded((count) => count + 1) }}>
        {shape === "circle" ? <G.AvatarButton name="Alex Morgan" /> : <G.Button intent="commit">Start here</G.Button>}
      </G.Spotlight>
      <G.Button size="sm" intent="neutral" onPress={() => setIsActive(true)}>{`Point again (ended ${ended}x)`}</G.Button>
    </G.Cluster>
  )
}

export const SpotlightStates: Story = {
  render: () => (
    <Matrix>
      <State label="Active: an accent ring with a soft pulse for 3s, then it settles and calls onEnd (press to replay)">
        <Replay />
      </State>
      <State label="Pill and circle targets">
        <G.Spotlight isActive shape="pill"><G.Button intent="commit">Pill</G.Button></G.Spotlight>
        <Replay shape="circle" />
      </State>
      <State label="Reduced motion: the ring stays static for the same 3s with no pulse (set prefers-reduced-motion: reduce in the browser to see it)">
        <G.Text tone="muted">Same ring, same time, no pulse.</G.Text>
      </State>
      <State label="Ended (isActive false): no ring, no layout space was taken">
        <G.Spotlight isActive={false}><G.Button intent="commit">Start here</G.Button></G.Spotlight>
      </State>
    </Matrix>
  ),
}

export const AvatarButtonFloating: Story = {
  render: () => (
    <Matrix>
      <State label="Floating launcher, 56px, no status">
        <G.AvatarButton name="Trợ lý NIVO" kind="agent" seed="nivo-assistant" size="floating" onPress={() => undefined} />
      </State>
      <State label="With status (success badge at the top end corner; its label describes the button)">
        <G.AvatarButton name="Trợ lý NIVO" kind="agent" seed="nivo-assistant" size="floating" status={{ tone: "success", label: "Online" }} onPress={() => undefined} />
        <G.AvatarButton name="Trợ lý NIVO" kind="agent" seed="nivo-assistant" size="floating" status={{ tone: "warning", label: "2 suggestions waiting" }} onPress={() => undefined} />
      </State>
      <State label="Spotlighted launcher">
        <G.Spotlight isActive shape="circle"><G.AvatarButton name="Trợ lý NIVO" kind="agent" seed="nivo-assistant" size="floating" status={{ tone: "accent", label: "New" }} onPress={() => undefined} /></G.Spotlight>
      </State>
    </Matrix>
  ),
}
