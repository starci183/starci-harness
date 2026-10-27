import { SurfaceCard, Terminal } from "@starci/grammar/core"
import type { DataSlot, SlotLabels } from "../../../modules/types"
import { SlotView } from "../../composites/SlotView"

/** Complete input of TaskTerminalBlockBase. */
export interface TaskTerminalBlockBaseProps {
    readonly props: {
        /** The newest attempt's terminal tail. */
        readonly lines: DataSlot<readonly string[]>
        /** Who runs it, and in which terminal; empty when neither is known. */
        readonly fact: string
        readonly labels: { readonly title: string; readonly slot: SlotLabels }
    }
    readonly on: { readonly retry: () => void }
}

const LINES_PLACEHOLDER: readonly string[] = ["", "", "", ""]

/** Pure half: the live terminal tail of the task's newest attempt. */
export const TaskTerminalBlockBase = (props: TaskTerminalBlockBaseProps) => {
    const { labels, fact } = props.props
    return (
        <SurfaceCard label={labels.title} headingLevel={2} {...(fact === "" ? {} : { fact })}>
            {/* The Grammar terminal has no skeleton flag: while waiting it draws the placeholder's blank lines in its own frame. */}
            <SlotView slot={props.props.lines} placeholder={LINES_PLACEHOLDER} labels={labels.slot} onRetry={props.on.retry}>
                {(lines) => <Terminal lines={lines} label={labels.title} />}
            </SlotView>
        </SurfaceCard>
    )
}
