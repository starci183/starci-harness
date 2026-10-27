import { InboxIcon } from "@heroicons/react/24/outline"
import {
    Alert,
    Badge,
    Button,
    Code,
    EmptyNotice,
    Heading,
    ListBox,
    MarkdownArticle,
    PrimaryRailLayout,
    RadioGroup,
    RelativeTime,
    SectionHeader,
    SurfaceCard,
    Text,
    Textarea,
    type ListBoxItem,
} from "@starci/grammar/core"
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react"
import type { ActionResult, Decision, Ruling } from "@contract"
import { useAction, useInbox } from "../../api/client"
import { DECISION_KIND, INBOX, LOCALE } from "../../app/labels"

const keyOf = (decision: Decision) => `${decision.project}/${decision.id}`

const KindBadge = ({ kind }: { readonly kind: Decision["kind"] }) => <Badge tone={DECISION_KIND[kind].tone}>{DECISION_KIND[kind].label}</Badge>

/** `**bold**` and `code` spans of a body paragraph, as the semantic elements MarkdownArticle owns. */
const inline = (paragraph: string): ReactNode[] =>
    paragraph.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={index}>{part.slice(2, -2)}</strong>
        if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={index}>{part.slice(1, -1)}</code>
        return <Fragment key={index}>{part}</Fragment>
    })

const DecisionBody = ({ body }: { readonly body: string }) => (
    <MarkdownArticle ariaLabel={INBOX.body}>
        {body
            .split(/\n\s*\n/)
            .map((paragraph) => paragraph.trim())
            .filter((paragraph) => paragraph !== "")
            .map((paragraph, index) => (
                <p key={index}>{inline(paragraph)}</p>
            ))}
    </MarkdownArticle>
)

const ResultAlert = ({ result }: { readonly result: ActionResult }) =>
    result.ok ? (
        <Alert tone="affirmative" title={INBOX.sent} description={result.message} />
    ) : (
        <Alert tone="negative" title={result.code === null ? INBOX.refused : `${INBOX.refused} · ${result.code}`} description={result.message} />
    )

interface DetailProps {
    readonly decision: Decision
    readonly onSent: (result: ActionResult) => void
}

const DecisionDetail = ({ decision, onSent }: DetailProps) => {
    const { mutateAsync } = useAction()
    const [option, setOption] = useState<string | null>(null)
    const [note, setNote] = useState("")
    const [isPending, setIsPending] = useState(false)
    const [refusal, setRefusal] = useState<ActionResult | null>(null)
    const canSend = option !== null || note.trim() !== ""

    const send = async () => {
        if (!canSend) return
        setIsPending(true)
        setRefusal(null)
        const ruling: Ruling = { option, note: note.trim() }
        try {
            const result = await mutateAsync({ kind: "ruling", project: decision.project, decision: decision.id, ruling })
            if (result.ok) onSent(result)
            else setRefusal(result)
        } catch (error) {
            setRefusal({ ok: false, code: null, message: error instanceof Error ? error.message : String(error) })
        } finally {
            setIsPending(false)
        }
    }

    return (
        <SurfaceCard ariaLabel={INBOX.detail}>
            <div className="app-stack">
                <div className="app-pair">
                    <span className="app-row">
                        <KindBadge kind={decision.kind} />
                        <Text as="span" size="sm" tone="muted">
                            {INBOX.raised(decision.project, decision.workflow, decision.askedBy)}
                        </Text>
                    </span>
                    <Heading level={2}>{decision.title}</Heading>
                </div>
                <DecisionBody body={decision.body} />
                {decision.options.length > 0 ? (
                    <RadioGroup
                        label={INBOX.ruling}
                        options={decision.options.map((item) => ({
                            value: item.id,
                            label: item.title,
                            ...(item.detail === "" ? {} : { description: item.detail }),
                        }))}
                        value={option}
                        onValueChange={setOption}
                        isDisabled={isPending}
                    />
                ) : null}
                <Textarea label={INBOX.note} rows={3} value={note} onValueChange={setNote} isDisabled={isPending} />
                {refusal === null ? null : <ResultAlert result={refusal} />}
                <div className="app-pair">
                    <span className="app-row">
                        <Button intent="commit" onPress={() => void send()} isDisabled={!canSend} isPending={isPending}>
                            {INBOX.send}
                        </Button>
                    </span>
                    <Text size="xs" tone="muted">
                        {INBOX.commandPrefix} <Code>{decision.command}</Code> {INBOX.commandSuffix}
                    </Text>
                </div>
            </div>
        </SurfaceCard>
    )
}

const LoadingDetail = () => (
    <SurfaceCard ariaLabel={INBOX.loading}>
        <div className="app-stack">
            <Text isSkeleton>.</Text>
            <Heading level={2} isSkeleton>
                .
            </Heading>
            <Text isSkeleton>.</Text>
            <Text isSkeleton>.</Text>
        </div>
    </SurfaceCard>
)

/** Arrow keys belong to these targets (text fields and other arrow-key widgets), not to the inbox selection. */
const ownsArrowKeys = (target: EventTarget | null) =>
    target instanceof HTMLElement &&
    (target.isContentEditable ||
        target.closest("input, textarea, select, [role='radiogroup'], [role='tablist'], [role='menu'], [role='dialog']") !== null)

/** Route `/inbox` · Cần quyết định: the open escalations on the rail, the selected one and its ruling form beside it. */
export const InboxPage = () => {
    const { data, isLoading, error } = useInbox()
    const decisions = useMemo(() => data ?? [], [data])
    const [selectedKey, setSelectedKey] = useState<string | null>(null)
    const [lastResult, setLastResult] = useState<ActionResult | null>(null)

    const selectedIndex = decisions.findIndex((decision) => keyOf(decision) === selectedKey)
    const effectiveIndex = selectedIndex === -1 ? (decisions.length > 0 ? 0 : -1) : selectedIndex
    const selected = effectiveIndex === -1 ? undefined : decisions[effectiveIndex]

    // Up/down move the selection from anywhere on the page; inside the list the vendor also moves focus with it.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
            if (event.altKey || event.ctrlKey || event.metaKey || ownsArrowKeys(event.target)) return
            const next = decisions[Math.min(decisions.length - 1, Math.max(0, effectiveIndex + (event.key === "ArrowDown" ? 1 : -1)))]
            if (next === undefined) return
            setSelectedKey(keyOf(next))
            if (!(event.target instanceof HTMLElement && event.target.closest("[role='listbox']") !== null)) event.preventDefault()
        }
        window.addEventListener("keydown", onKeyDown, true)
        return () => window.removeEventListener("keydown", onKeyDown, true)
    }, [decisions, effectiveIndex])

    const onSent = (result: ActionResult) => {
        setLastResult(result)
        // The decided item leaves the inbox; the selection falls to the row that takes its place.
        const neighbour = decisions[effectiveIndex + 1] ?? decisions[effectiveIndex - 1]
        setSelectedKey(neighbour === undefined ? null : keyOf(neighbour))
    }

    const items: ListBoxItem[] = decisions.map((decision) => ({
        id: keyOf(decision),
        label: decision.title,
        description: (
            <span className="app-row">
                <KindBadge kind={decision.kind} />
                <span>{decision.id}</span>
            </span>
        ),
        trailing: <RelativeTime dateTime={decision.raisedAt} locale={LOCALE} size="xs" tone="muted" />,
    }))

    const list = (
        <SurfaceCard ariaLabel={INBOX.listCard}>
            <ListBox
                label={INBOX.list}
                items={items}
                selectionMode="single"
                selectionIndicator="none"
                selectedIds={selected === undefined ? [] : [keyOf(selected)]}
                onSelectionChange={(ids) => {
                    const id = ids[0]
                    if (id !== undefined) setSelectedKey(id)
                }}
                isLoading={isLoading}
                emptyContent={<EmptyNotice iconSource={InboxIcon} message={INBOX.empty} />}
            />
        </SurfaceCard>
    )

    let detail: ReactNode
    if (isLoading) detail = <LoadingDetail />
    else if (error !== null) detail = null
    else if (selected === undefined)
        detail = (
            <SurfaceCard ariaLabel={INBOX.detail}>
                <EmptyNotice iconSource={InboxIcon} message={INBOX.empty} description={INBOX.emptyHint} />
            </SurfaceCard>
        )
    else detail = <DecisionDetail key={keyOf(selected)} decision={selected} onSent={onSent} />

    return (
        <div className="app-page-stack">
            <SectionHeader level={1} title={INBOX.title} description={INBOX.description} {...(data === undefined ? {} : { count: decisions.length })} />
            {error === null ? null : <Alert tone="negative" title={INBOX.loadError} description={error.message} />}
            {lastResult === null ? null : <ResultAlert result={lastResult} />}
            <PrimaryRailLayout primary={detail} rail={list} railPosition="leading" railWidth="wide" collapsedOrder="rail-first" />
        </div>
    )
}
