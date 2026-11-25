"use client"

import { useState, type ReactNode } from "react"
import { Button } from "../../leaf/Button/index.js"
import { TablerDots } from "../../leaf/Icon/tabler.js"
import { IconButton } from "../../leaf/IconButton/index.js"
import { DropdownMenu } from "../../branch/DropdownMenu/index.js"
import { SchemaForm, type SchemaFormDecision, type SchemaFormField, type SchemaFormLabels, type SchemaFormMark, type SchemaFormMeter, type SchemaFormPath, type SchemaFormValue } from "../SchemaForm/index.js"
import { SurfaceCard, type ItemMenu, type SurfaceCardTone } from "../SurfaceCard/index.js"
import { useIsLoading } from "../../regionScope.js"
import type { NoChildren } from "../../tier.js"

/** The words of the card's own controls, the app's. */
export type ApprovalCardLabels = {
    /** The toggle that opens the editable fields, e.g. "Quick edit". */
    readonly edit: string
    /** Saves the edits to the fields, e.g. "Save". */
    readonly save: string
    /** Drops the edits and closes the fields, e.g. "Cancel". */
    readonly cancel: string
}

export type ApprovalCardProps = NoChildren & {
    /** What is waiting for approval, e.g. "Approve the TikTok script". */
    readonly title: string
    /** One short fact beside the title, e.g. the deadline: "Approve by 18:00 today". */
    readonly meta?: string
    /** The facts of the request as a schema and its value, drawn as a card of facts (label beside value). */
    readonly schema: SchemaFormField
    readonly value: SchemaFormValue
    /** The paths of the fields the person may fix on the card without opening the full editor; the rest stay words. None: the card has no quick edit. */
    readonly editable?: readonly SchemaFormPath[]
    /** The edited value, when the person saves the quick edit. The card keeps the draft until then and drops it on cancel. */
    readonly onSave?: (next: SchemaFormValue) => void
    readonly formLabels: SchemaFormLabels
    readonly labels: ApprovalCardLabels
    readonly marks?: Readonly<Record<SchemaFormPath, SchemaFormMark>>
    readonly proposals?: Readonly<Record<SchemaFormPath, unknown>>
    readonly onProposal?: (path: SchemaFormPath, decision: SchemaFormDecision) => void
    readonly meters?: Readonly<Record<SchemaFormPath, SchemaFormMeter>>
    /** The one solid action of the card: the approval. It is disabled while the quick edit is open, so the person never approves what they have not saved. */
    readonly approve: { readonly label: string; readonly press: () => void; readonly isPending?: boolean }
    /** A way into the full editor (a Studio), as a text button next to the approval. */
    readonly open?: { readonly label: string; readonly href: string }
    /** The commands beyond the visible ones (decline, ask the agent to change it). */
    readonly menu?: ItemMenu
    /** A line under the card that says what the quick edit does and what opening the editor keeps. */
    readonly note?: ReactNode
    /** A card that waits on the reader draws its edge in the warning token; `none` leaves the plain edge. Default `warning`. */
    readonly tone?: SurfaceCardTone | "none"
    /** The request has not arrived yet: the card keeps its geometry. */
    readonly isLoading?: boolean
}

/**
 * FRAME - `ApprovalCard`: one request that waits for a yes, as the card of an approval (`SurfaceCard`): its title and deadline in the head, the facts of the request as a card of
 * facts drawn from a schema (`SchemaForm layout="kv" readOnly`), and at the foot the one solid action, the way into the full editor and the commands beyond. A quick edit opens only
 * the `editable` fields as controls with Save and Cancel; the approval waits until the edit is saved or dropped. The words, the facts and the actions are the app's; the card owns the
 * states (the agent writing a field, a field the person edited, a change the agent proposes) through the same marks `SchemaForm` takes.
 */
export const ApprovalCard = ({ title, meta, schema, value, editable = [], onSave, formLabels, labels, marks, proposals, onProposal, meters, approve, open, menu, note, tone = "warning", isLoading: ownLoading }: ApprovalCardProps) => {
    const isLoading = useIsLoading(ownLoading)
    const [draft, setDraft] = useState<SchemaFormValue | null>(null)
    const isEditing = draft !== null
    const canEdit = editable.length > 0 && onSave !== undefined
    const actions = (
        <>
            <Button variant="primary" isPending={approve.isPending === true} isDisabled={isEditing} onPress={approve.press}>{approve.label}</Button>
            {canEdit ? <Button aria-pressed={isEditing} onPress={() => setDraft(isEditing ? null : value)}>{labels.edit}</Button> : null}
            {open === undefined ? null : <Button variant="border" href={open.href}>{open.label}</Button>}
            {menu === undefined ? null : <DropdownMenu placement="top end" entries={menu.entries} trigger={<IconButton label={menu.label} source={TablerDots} variant="border" />} />}
        </>
    )
    return (
        <div data-tier="frame" data-component="ApprovalCard" data-contract="SURFACE-2" data-grammar-approval-state={isEditing ? "editing" : "ready"} className="starci-core-approval-card">
            <SurfaceCard
                label={title}
                {...(meta === undefined ? {} : { fact: meta })}
                {...(tone === "none" ? {} : { tone })}
                actions={actions}
                {...(note === undefined ? {} : { note })}
                isLoading={isLoading}
            >
                <SchemaForm
                    label={title}
                    schema={schema}
                    value={draft ?? value}
                    onChange={(next) => { if (draft !== null) setDraft(next) }}
                    labels={formLabels}
                    layout="kv"
                    readOnly
                    editable={isEditing ? editable : []}
                    {...(marks === undefined ? {} : { marks })}
                    {...(proposals === undefined ? {} : { proposals })}
                    {...(onProposal === undefined ? {} : { onProposal })}
                    {...(meters === undefined ? {} : { meters })}
                />
                {isEditing ? (
                    <div className="starci-core-approval-edit">
                        <Button onPress={() => { onSave?.(draft); setDraft(null) }}>{labels.save}</Button>
                        <Button variant="border" onPress={() => setDraft(null)}>{labels.cancel}</Button>
                    </div>
                ) : null}
            </SurfaceCard>
        </div>
    )
}
