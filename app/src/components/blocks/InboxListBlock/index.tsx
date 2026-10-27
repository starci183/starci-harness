import type { Decision } from "@contract"
import { decisionKey, selectedIndexOf, useInboxArrowKeys } from "../../../hooks/inbox"
import { useInboxQuery } from "../../../hooks/query"
import { mapSlot, slotOfQuery, useSlotLabels } from "../../../hooks/slot"
import { DECISION_KIND, INBOX, LOCALE } from "../../../modules/i18n"
import { InboxListBlockBase, type DecisionItemView } from "./component"

/** Input of InboxListBlock: the page's selection. */
export interface InboxListBlockProps {
    readonly selectedKey: string | null
    readonly onSelect: (key: string) => void
}

const NO_DECISIONS: readonly Decision[] = []

const toViews = (decisions: readonly Decision[]): readonly DecisionItemView[] =>
    decisions.map((decision) => ({
        key: decisionKey(decision),
        id: decision.id,
        title: decision.title,
        kind: DECISION_KIND[decision.kind],
        raisedAt: decision.raisedAt,
    }))

/** The inbox list on the rail; arrow keys move its selection from anywhere on the page. */
export const InboxListBlock = (props: InboxListBlockProps) => {
    const query = useInboxQuery()
    const slotLabels = useSlotLabels()
    const decisions = query.data ?? NO_DECISIONS
    const index = selectedIndexOf(decisions, props.selectedKey)
    const selected = decisions[index]
    useInboxArrowKeys(decisions, index, props.onSelect)
    return (
        <InboxListBlockBase
            props={{
                decisions: mapSlot(slotOfQuery(query), toViews),
                selectedKey: selected === undefined ? null : decisionKey(selected),
                locale: LOCALE,
                labels: { card: INBOX.listCard, list: INBOX.list, slot: slotLabels(INBOX.empty) },
            }}
            on={{ retry: () => void query.refetch(), select: props.onSelect }}
        />
    )
}
