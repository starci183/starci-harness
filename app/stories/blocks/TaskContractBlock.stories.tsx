import type { Meta, StoryObj } from "@storybook/react-vite"
import { TaskContractBlockBase } from "../../src/components/blocks/TaskContractBlock/component"
import { COMMON, TASK } from "../../src/modules/i18n"
import { loading, noop, ready, slotLabels } from "../support"

const meta = {
    title: "TaskContractBlock",
    component: TaskContractBlockBase,
    args: {
        props: {
            contract: ready({
                summary: "Thêm gói Premium tháng và năm. Seed bảng `plan`, query `plans` trả giá và chu kỳ.",
                allowPaths: ["src/modules/subscription/plan/**", "src/migrations/*-plan.ts"],
                dependsOn: ["B1"],
                record: ["impl.commerce.subscription"],
                step: ["code"],
            }),
            labels: {
                title: TASK.contract,
                allowPaths: TASK.allowPaths,
                anyPath: TASK.anyPath,
                deps: TASK.deps,
                record: TASK.record,
                step: TASK.step,
                none: COMMON.none,
                slot: slotLabels(TASK.notFound),
            },
        },
        on: { retry: noop },
    },
} satisfies Meta<typeof TaskContractBlockBase>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = { parameters: { dna: { pair: "TaskContractBlock", phase: "ready" } } }

export const Loading: Story = {
    args: { props: { ...meta.args.props, contract: loading() } },
    parameters: { dna: { pair: "TaskContractBlock", phase: "loading" } },
}
