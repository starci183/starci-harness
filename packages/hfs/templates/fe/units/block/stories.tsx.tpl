import type { Meta, StoryObj } from "@storybook/react-vite"
import { {{Name}}Base } from "../../src/components/blocks/{{Name}}/component"
import type { {{Name}}BaseProps } from "../../src/components/blocks/{{Name}}/component"
import { loadingSlot } from "../../src/hooks/slot/slot.shared"

/** The ready read every story draws: one value, settled. */
const READY: {{Name}}BaseProps["props"] = {
    title: "{{title}}",
{{shapeLabelsFixture}}    item: { items: { id: "{{nameKebab}}-1"{{fixtureShape}} } },
    slotLabels: { empty: "Nothing yet", forbidden: "Not allowed", error: "Could not load", retry: "Try again" },
}

/** The pure half of {{Name}} drawn from fixtures: {{storiesDoc}} and the loading twin of the first. */
const meta = {
    title: "{{Name}}",
    component: {{Name}}Base,
    args: { {{shapeArg}}props: READY, on: { retry: () => undefined } },
} satisfies Meta<typeof {{Name}}Base>

export default meta

type Story = StoryObj<typeof meta>
{{readyStories}}

/** The loading twin of {{firstStory}}: the same tree drawn from the placeholder with every leaf resting. */
export const {{firstStory}}Skeleton: Story = {
    args: { {{shapeArg}}props: { ...READY, item: loadingSlot() } },
    parameters: { dna: { pair: "{{firstStory}}", phase: "loading" } },
}
