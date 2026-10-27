import { Alert, Badge, Button, Code, DescriptionList, Heading, RadioGroup, SurfaceCard, Text, Textarea } from "@starci/grammar/core"
import type { DataSlot, ResultNotice, SlotLabels, ToneLabel } from "../../../modules/types"
import { DecisionBody } from "../../composites/DecisionBody"
import { SlotView } from "../../composites/SlotView"

/** The drawn shapes of a decision: `ruling` asks for the owner's ruling, `ruled` shows the ruling already sent. */
export type InboxDetailShape = "ruling" | "ruled"

/** One decision, resolved for drawing. */
export interface DecisionView {
    readonly kind: ToneLabel
    readonly raised: string
    readonly title: string
    readonly paragraphs: readonly string[]
    readonly options: readonly { readonly value: string; readonly label: string; readonly description?: string }[]
    /** The harness CLI command the ruling becomes, so the owner sees what will run. */
    readonly command: string
}

/** Copy the connected block resolves. */
export interface InboxDetailBlockLabels {
    readonly detail: string
    readonly body: string
    readonly ruling: string
    readonly note: string
    readonly send: string
    readonly commandPrefix: string
    readonly commandSuffix: string
    readonly sent: string
    readonly ruledOption: string
    readonly ruledNote: string
    readonly ruledHint: string
    readonly slot: SlotLabels
}

/** Complete input of InboxDetailBlockBase. */
export interface InboxDetailBlockBaseProps {
    readonly shape: InboxDetailShape
    readonly props: {
        readonly decision: DataSlot<DecisionView>
        readonly option: string | null
        readonly note: string
        readonly canSend: boolean
        readonly isPending: boolean
        readonly refusal: ResultNotice | null
        /** What was sent, in words; read by the `ruled` shape. */
        readonly ruled: { readonly option: string; readonly note: string }
        readonly labels: InboxDetailBlockLabels
    }
    readonly on: {
        readonly retry: () => void
        readonly setOption: (option: string | null) => void
        readonly setNote: (note: string) => void
        readonly send: () => void
    }
}

const DECISION_PLACEHOLDER: DecisionView = {
    kind: { label: "", tone: "neutral" },
    raised: "",
    title: "",
    paragraphs: ["", ""],
    // The radio group has no skeleton flag: its options rest with blank labels, so the form keeps its height.
    options: ["o0", "o1", "o2"].map((value) => ({ value, label: " " })),
    command: "",
}

type PartProps = InboxDetailBlockBaseProps & { readonly decision: DecisionView; readonly isSkeleton: boolean }

/** The command line under either shape. */
const CommandLine = ({ decision, labels, isSkeleton }: { readonly decision: DecisionView; readonly labels: InboxDetailBlockLabels; readonly isSkeleton: boolean }) => (
    <Text size="xs" tone="muted" isSkeleton={isSkeleton}>
        {labels.commandPrefix} <Code>{decision.command}</Code> {labels.commandSuffix}
    </Text>
)

/** The `ruling` shape: options, a note, and the send action. */
const RulingForm = (props: PartProps) => {
    const { labels, refusal } = props.props
    return (
        <>
            {props.decision.options.length > 0 ? (
                <RadioGroup
                    label={labels.ruling}
                    options={props.decision.options.map((option) => ({ ...option }))}
                    value={props.props.option}
                    onValueChange={props.on.setOption}
                    isDisabled={props.props.isPending}
                />
            ) : null}
            <Textarea
                label={labels.note}
                rows={3}
                value={props.props.note}
                onValueChange={props.on.setNote}
                isDisabled={props.props.isPending}
                isSkeleton={props.isSkeleton}
            />
            {refusal === null ? null : <Alert key={refusal.n} tone="negative" title={refusal.title} description={refusal.description} />}
            <div className="app-pair">
                <span className="app-row">
                    <Button
                        intent="commit"
                        onPress={props.on.send}
                        isDisabled={!props.props.canSend}
                        isPending={props.props.isPending}
                        isSkeleton={props.isSkeleton}
                    >
                        {labels.send}
                    </Button>
                </span>
                <CommandLine decision={props.decision} labels={labels} isSkeleton={props.isSkeleton} />
            </div>
        </>
    )
}

/** The `ruled` shape: what was sent, and that it is on its way. */
const RuledSummary = (props: PartProps) => {
    const { labels, ruled } = props.props
    return (
        <>
            <DescriptionList
                isDivided
                items={[
                    { id: "option", term: labels.ruledOption, description: ruled.option },
                    { id: "note", term: labels.ruledNote, description: ruled.note },
                ]}
            />
            <Alert tone="affirmative" title={labels.sent} description={labels.ruledHint} />
            <CommandLine decision={props.decision} labels={labels} isSkeleton={props.isSkeleton} />
        </>
    )
}

/** Pure half: the selected decision, its body, and the owner's ruling or the ruling already sent. */
export const InboxDetailBlockBase = (props: InboxDetailBlockBaseProps) => {
    const { labels } = props.props
    return (
        <SurfaceCard ariaLabel={labels.detail}>
            <SlotView slot={props.props.decision} placeholder={DECISION_PLACEHOLDER} labels={labels.slot} onRetry={props.on.retry}>
                {(decision, isSkeleton) => {
                    let action
                    switch (props.shape) {
                        case "ruling":
                            action = <RulingForm {...props} decision={decision} isSkeleton={isSkeleton} />
                            break
                        case "ruled":
                            action = <RuledSummary {...props} decision={decision} isSkeleton={isSkeleton} />
                            break
                    }
                    return (
                        <div className="app-stack">
                            <div className="app-pair">
                                <span className="app-row">
                                    <Badge tone={decision.kind.tone} isSkeleton={isSkeleton}>
                                        {decision.kind.label}
                                    </Badge>
                                    <Text as="span" size="sm" tone="muted" isSkeleton={isSkeleton}>
                                        {decision.raised}
                                    </Text>
                                </span>
                                <Heading level={2} isSkeleton={isSkeleton}>
                                    {decision.title}
                                </Heading>
                            </div>
                            <DecisionBody label={labels.body} paragraphs={decision.paragraphs} isSkeleton={isSkeleton} />
                            {action}
                        </div>
                    )
                }}
            </SlotView>
        </SurfaceCard>
    )
}
