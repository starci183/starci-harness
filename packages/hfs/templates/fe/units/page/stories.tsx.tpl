import type { Meta, StoryObj } from "@storybook/react-vite"
import { {{Name}}Base } from "../../src/features/pages/{{Name}}/component"
import type { {{Name}}BaseProps } from "../../src/features/pages/{{Name}}/component"

/** The copy of the resolved page. */
const READY: {{Name}}BaseProps["props"] = {
    title: "{{title}}",
    breadcrumbLabel: "Breadcrumb",
    homeLabel: "Home",
    homeHref: "/",
{{emptyFixture}}{{tabsFixture}}    isSkeleton: false,
}

/** The pure half of {{Name}}: the resolved page and its loading view, paired for the DNA gate. */
const meta = {
    title: "{{Name}}",
    component: {{Name}}Base,
    args: { props: READY },
} satisfies Meta<typeof {{Name}}Base>

export default meta

type Story = StoryObj<typeof meta>

/** The resolved page. */
export const Ready: Story = {
    parameters: { dna: { pair: "Ready", phase: "ready" } },
}

/** The route's loading view: the same page, its header resting in its own boxes. */
export const ReadySkeleton: Story = {
    args: { props: { ...READY, isSkeleton: true } },
    parameters: { dna: { pair: "Ready", phase: "loading" } },
}
