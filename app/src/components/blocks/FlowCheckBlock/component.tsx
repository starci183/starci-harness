import { ExclamationTriangleIcon } from "@heroicons/react/24/outline"
import { Alert, FencedCodeBlock, Section, Text } from "@starci/grammar/core"
import type { DataSlot, SlotLabels } from "../../../modules/types"
import { SlotView } from "../../composites/SlotView"

/** The lanes' flow and what the flow check found. */
export interface FlowCheckView {
    readonly flow: readonly string[]
    readonly problems: readonly string[]
    readonly problemsTitle: string
}

/** Copy the connected block resolves. */
export interface FlowCheckBlockLabels {
    readonly title: string
    readonly code: string
    readonly noLanes: string
    readonly clean: string
    readonly cleanHint: string
    readonly slot: SlotLabels
}

/** Complete input of FlowCheckBlockBase. */
export interface FlowCheckBlockBaseProps {
    readonly props: {
        readonly check: DataSlot<FlowCheckView>
        readonly labels: FlowCheckBlockLabels
    }
    readonly on: { readonly retry: () => void }
}

const CHECK_PLACEHOLDER: FlowCheckView = { flow: [], problems: [], problemsTitle: "" }

/** Pure half: a section with the lanes' flow as code, then a clean verdict or each flow problem. */
export const FlowCheckBlockBase = (props: FlowCheckBlockBaseProps) => {
    const { labels } = props.props
    return (
        <SlotView slot={props.props.check} placeholder={CHECK_PLACEHOLDER} labels={labels.slot} onRetry={props.on.retry} isEmpty={() => false} render={(check, isLoading) => {
                const flow =
                    check.flow.length === 0 ? (
                        <Text role="body" tone="muted" isLoading={isLoading}>
                            {labels.noLanes}
                        </Text>
                    ) : (
                        <FencedCodeBlock label={labels.code} code={check.flow.join("\n")} />
                    )
                const head = {
                    title: labels.title,
                    isLoading,
                    ...(check.problems.length === 0 ? {} : { fact: check.problemsTitle }),
                }
                // A verdict has nowhere to go before the check answers (LOADING-5); the Alert has no resting shape.
                if (isLoading) return <Section {...head}>{flow}</Section>
                if (check.problems.length === 0) {
                    return (
                        <Section {...head}>
                            {flow}
                            <Alert tone="affirmative" title={labels.clean} description={labels.cleanHint} />
                        </Section>
                    )
                }
                return (
                    <Section {...head}>
                        {flow}
                        <Section
                            kind="list"
                            ariaLabel={check.problemsTitle}
                            items={check.problems.map((problem) => ({
                                id: problem,
                                title: problem,
                                state: "negative" as const,
                                leading: { icon: ExclamationTriangleIcon },
                            }))}
                            empty={null}
                        />
                    </Section>
                )
            }} />
    )
}
