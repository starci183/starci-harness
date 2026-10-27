import type { ActionResult, Decision } from "@contract"
import { useState } from "react"
import { decisionKey, selectedIndexOf } from "../../../hooks/inbox"
import { useActionCommand, useInboxQuery } from "../../../hooks/query"
import { slotOfQuery, useSlotLabels } from "../../../hooks/slot"
import { DECISION_KIND, INBOX } from "../../../modules/i18n"
import type { DataSlot, ResultNotice } from "../../../modules/types"
import { InboxDetailBlockBase, type DecisionView } from "./component"

/** Input of InboxDetailBlock: the page's selection, and what to do once a ruling is sent. */
export interface InboxDetailBlockProps {
    readonly selectedKey: string | null
    /** The ruling went through; the page reports it and moves the selection on. */
    readonly onSent: (result: ActionResult, key: string, nextKey: string | null) => void
}

/** The owner's unsent ruling on one decision. */
interface Draft {
    readonly key: string
    readonly option: string | null
    readonly note: string
}

/** A ruling sent this session, kept until the decision leaves the inbox. */
interface Sent {
    readonly option: string | null
    readonly note: string
}

const toView = (decision: Decision): DecisionView => ({
    kind: DECISION_KIND[decision.kind],
    raised: INBOX.raised(decision.project, decision.workflow, decision.askedBy),
    title: decision.title,
    paragraphs: decision.body
        .split(/\n\s*\n/)
        .map((paragraph) => paragraph.trim())
        .filter((paragraph) => paragraph !== ""),
    options: decision.options.map((option) => ({
        value: option.id,
        label: option.title,
        ...(option.detail === "" ? {} : { description: option.detail }),
    })),
    command: decision.command,
})

const refusalOf = (n: number, result: ActionResult): ResultNotice => ({
    n,
    isOk: false,
    title: result.code === null ? INBOX.refused : `${INBOX.refused} · ${result.code}`,
    description: result.message,
})

/** The selected decision and the owner's ruling on it, sent through the harness ruling verb. */
export const InboxDetailBlock = (props: InboxDetailBlockProps) => {
    const query = useInboxQuery()
    const { send } = useActionCommand()
    const slotLabels = useSlotLabels()
    const [draft, setDraft] = useState<Draft | null>(null)
    const [isPending, setIsPending] = useState(false)
    const [refusal, setRefusal] = useState<{ readonly key: string; readonly notice: ResultNotice } | null>(null)
    const [sent, setSent] = useState<ReadonlyMap<string, Sent>>(new Map())

    const decisions = query.data ?? []
    const index = selectedIndexOf(decisions, props.selectedKey)
    const selected = decisions[index]
    const key = selected === undefined ? null : decisionKey(selected)
    const current: Draft = draft !== null && draft.key === key ? draft : { key: key ?? "", option: null, note: "" }
    const ruled = key === null ? undefined : sent.get(key)
    const canSend = current.option !== null || current.note.trim() !== ""
    const decision: DataSlot<DecisionView> = { ...slotOfQuery(query), items: selected === undefined ? undefined : toView(selected) }
    const optionTitle = (option: string | null) =>
        option === null ? INBOX.noOption : (selected?.options.find((candidate) => candidate.id === option)?.title ?? option)

    const submit = async () => {
        if (selected === undefined || key === null || !canSend) return
        setIsPending(true)
        setRefusal(null)
        const ruling = { option: current.option, note: current.note.trim() }
        const result = await send({ kind: "ruling", project: selected.project, decision: selected.id, ruling })
        setIsPending(false)
        if (!result.ok) {
            setRefusal((previous) => ({ key, notice: refusalOf((previous?.notice.n ?? 0) + 1, result) }))
            return
        }
        setSent((previous) => new Map(previous).set(key, ruling))
        setDraft(null)
        // The decided item leaves the inbox; the selection falls to the row that takes its place.
        const neighbour = decisions[index + 1] ?? decisions[index - 1]
        props.onSent(result, key, neighbour === undefined ? null : decisionKey(neighbour))
    }

    return (
        <InboxDetailBlockBase
            shape={ruled === undefined ? "ruling" : "ruled"}
            props={{
                decision,
                option: current.option,
                note: current.note,
                canSend,
                isPending,
                refusal: refusal !== null && refusal.key === key ? refusal.notice : null,
                ruled: { option: optionTitle(ruled?.option ?? null), note: ruled === undefined || ruled.note === "" ? INBOX.noNote : ruled.note },
                labels: {
                    detail: INBOX.detail,
                    body: INBOX.body,
                    ruling: INBOX.ruling,
                    note: INBOX.note,
                    send: INBOX.send,
                    commandPrefix: INBOX.commandPrefix,
                    commandSuffix: INBOX.commandSuffix,
                    sent: INBOX.sent,
                    ruledOption: INBOX.ruledOption,
                    ruledNote: INBOX.ruledNote,
                    ruledHint: INBOX.ruledHint,
                    slot: slotLabels(INBOX.empty, INBOX.emptyHint),
                },
            }}
            on={{
                retry: () => void query.refetch(),
                setOption: (option) => setDraft({ ...current, option }),
                setNote: (note) => setDraft({ ...current, note }),
                send: () => void submit(),
            }}
        />
    )
}
