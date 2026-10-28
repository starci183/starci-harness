import type { Meta, StoryObj } from "@storybook/react-vite"
import { {{Name}}Base } from "../../src/features/overlays/{{Name}}/component"
import type { {{Name}}BaseProps } from "../../src/features/overlays/{{Name}}/component"

/** The copy of the overlay. */
const COPY: {{Name}}BaseProps["props"] = {
    isOpen: false,
    triggerLabel: "Open",
    title: "{{title}}",
{{labelsFixture}}    cancelLabel: "Cancel",
    submitLabel: "Save",
}

/** The pure half of {{Name}}: closed behind its trigger, and open. */
const meta = {
    title: "{{Name}}",
    component: {{Name}}Base,
    args: { props: COPY, on: { openChange: () => undefined, {{submitFixture}} } },
} satisfies Meta<typeof {{Name}}Base>

export default meta

type Story = StoryObj<typeof meta>

/** Closed: only its trigger shows. */
export const Closed: Story = {}

/** Open above the page. */
export const Open: Story = { args: { props: { ...COPY, isOpen: true } } }
