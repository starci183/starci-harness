"use client"

import { withRegionLoading } from "../../regionScope.js"
import { useId, type DragEvent, type KeyboardEvent } from "react"
import { staticRowClassName } from "../../classNames.js"
import { LeadingNumber } from "../../LeadingNumber.js"
import { StateMark } from "../../StateMark.js"
import { treatmentFor } from "../../state.js"
import { DropdownMenu } from "../../branch/DropdownMenu/index.js"
import { AgentName } from "../../leaf/AgentName/index.js"
import { Avatar } from "../../leaf/Avatar/index.js"
import { Badge } from "../../leaf/Badge/index.js"
import { Button } from "../../leaf/Button/index.js"
import { Icon } from "../../leaf/Icon/index.js"
import { glyphSource } from "../../leaf/Icon/glyphs.js"
import { IconButton } from "../../leaf/IconButton/index.js"
import { IconTile } from "../../leaf/IconTile/index.js"
import { Link } from "../../leaf/Link/index.js"
import { Skeleton, SkeletonPlaceholder } from "../../leaf/Skeleton/index.js"
import type { NoChildren } from "../../tier.js"
import type { BadgeData, ItemAction, ItemLeading, ListRowData } from "../../surfaceCardData.js"
import { TablerDots, TablerGripVertical } from "../../leaf/Icon/tabler.js"

/** The gutter mark of a diff row (0.37.28): plus, the true minus sign, tilde; monospace, so the three stand in one column of their own. */
const DIFF_GLYPHS = { added: "+", removed: "−", changed: "~" } as const
/** The visible label over a diff row's value (0.55.0) when the app passes no `diffLabel`: an app localises it ("Đang dùng", "Sau khi duyệt"). */
const DIFF_LABELS = { added: "Added", removed: "Removed", changed: "Changed" } as const

/**
 * Starts a drag with a LIFTED copy of the row as the image under the pointer: the copy carries `data-grammar-row-lifted` (a soft shadow on the card face, no tilt, no scale), stands
 * out of the flow for one tick so the browser can take its picture, and is removed at once; the row itself stays put as the origin slot.
 */
const liftRow = (event: DragEvent<HTMLLIElement>) => {
    const row = event.currentTarget
    const parent = row.parentElement
    if (parent === null || typeof event.dataTransfer.setDragImage !== "function") return
    const copy = row.cloneNode(true) as HTMLElement
    copy.setAttribute("data-grammar-row-lifted", "true")
    copy.removeAttribute("draggable")
    copy.removeAttribute("data-grammar-row-origin")
    copy.setAttribute("aria-hidden", "true")
    const box = row.getBoundingClientRect()
    copy.style.width = `${box.width}px`
    parent.appendChild(copy)
    event.dataTransfer.setDragImage(copy, Math.max(0, event.clientX - box.left), Math.max(0, event.clientY - box.top))
    window.setTimeout(() => copy.remove(), 0)
}

export type ListRowProps = NoChildren & {
    readonly row: ListRowData
    /**
     * Draw the row as inert geometry while its content is unresolved (knowledge STATE-8): the title becomes a Skeleton
     * text line, the description a second line, the leading mark a Skeleton circle and the action a small Skeleton
     * footprint, each only if the row carries it, so the loading row has the size of the loaded one. The `detail` is
     * drawn as the caller built it, from the same data with its own skeleton flag. The row is `aria-hidden` and
     * renders no badge or command; the collection owns `aria-busy`.
     */
    readonly isLoading?: boolean
}

const Leading = ({ leading }: { readonly leading: ItemLeading }) => {
    if (leading.avatar !== undefined) return <Avatar {...leading.avatar} size={leading.size ?? "md"} isDecorative />
    if (leading.icon !== undefined) return leading.state === undefined ? <IconTile source={leading.icon} /> : <IconTile source={leading.icon} state={leading.state} />
    return <LeadingNumber position={leading.position} {...(leading.format === undefined ? {} : { format: leading.format })} />
}

/** The quiet mark at the end of a pressable row: it opens something. Decorative (the title is the control); a right-to-left page mirrors it in CSS. */
const RowChevron = () => (
    <span className="starci-core-list-row-chevron" data-grammar-row-chevron="true" aria-hidden="true"><Icon source={glyphSource("chevron-end")} usage="text" /></span>
)

const RowBadge = ({ badge }: { readonly badge: BadgeData }) => (
    badge.isDot === true
        ? <Badge isDot tone={badge.tone ?? "neutral"}>{badge.label}</Badge>
        : <Badge tone={badge.tone ?? "neutral"}>{badge.label}</Badge>
)

const RowAction = ({ action }: { readonly action: ItemAction }) => {
    const look = { variant: action.variant ?? "border" } as const
    const arrow = action.endArrow === true ? { endArrow: true as const } : {}
    return action.href === undefined
        ? <Button size="sm" {...look} {...arrow} isDisabled={action.isDisabled === true} isPending={action.isPending === true} onPress={action.press}>{action.label}</Button>
        : <Button size="sm" {...look} {...arrow} isDisabled={action.isDisabled === true} isPending={action.isPending === true} href={action.href}>{action.label}</Button>
}

/**
 * The one drawing of a row, inside the `Section` of rows (and a Board item card): leading mark, title with its
 * badges, one supporting line, one visible command and a menu, with an optional detail under the copy. It is an `<li>`
 * and is never rendered loose; the collection that holds it is the list.
 */
const ListRowInner = ({ row, isLoading = false }: ListRowProps) => {
    const state = row.state ?? "neutral"
    const treatment = treatmentFor(state)
    const hasLeading = row.leading !== undefined
    const hasMark = !hasLeading && treatment.mark === "check"
    const hasActions = row.action !== undefined || row.menu !== undefined || row.control != null
    const hasTrail = row.meta !== undefined || row.badges !== undefined
    // A pressable row (onPress or href) ends in a chevron, unless it has its own command, menu or control: those already end it, and a chevron after a button would read as a second one.
    const hasChevron = (row.onPress !== undefined || row.href !== undefined) && !hasActions
    const chevronOnly = hasChevron && !hasTrail
    // Two or more commands (an action and a menu, a control): on a narrow container they stand under the text, which keeps the row's width.
    const actionCount = [row.action, row.menu, row.control].filter((part) => part != null).length
    const drag = row.drag
    const hintId = useId()
    const isFoot = row.actionPlacement === "foot"
    const skeletonActions = <span className="starci-core-list-row-actions"><span className="starci-core-list-row-skeleton-action"><Skeleton shape="rect" /></span></span>
    const actions = (
        <span className="starci-core-list-row-actions" data-contract="GAP-2">
            {row.control == null ? null : <span className="starci-core-list-row-control" data-contract="GAP-2">{row.control}</span>}
            {row.action === undefined ? null : <RowAction action={row.action} />}
            {row.menu === undefined ? null : (
                <DropdownMenu
                    placement="bottom end"
                    entries={row.menu.entries}
                    trigger={<IconButton label={row.menu.label} source={TablerDots} variant="border" />}
                />
            )}
        </span>
    )
    const pressKeys = drag?.onMoveKey === undefined ? {} : {
        "aria-keyshortcuts": "Alt+ArrowLeft Alt+ArrowRight",
        ...(drag.keyHint === undefined ? {} : { "aria-describedby": hintId }),
        onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
            if (!event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return
            event.preventDefault()
            drag.onMoveKey?.(event.key === "ArrowLeft" ? "previous" : "next")
        },
    }
    if (isLoading) {
        return (
            <li
                aria-hidden="true"
                className={`${staticRowClassName} starci-core-list-row`}
                data-grammar-row="true"
                data-component="ListRow"
                data-tier="composite"
                data-grammar-skeleton="true"
                data-grammar-state="neutral"
                data-grammar-treatment={treatmentFor("neutral").tone}
                data-grammar-leading={hasLeading || row.diff !== undefined ? "true" : "false"}
                data-grammar-actions={hasActions || chevronOnly ? "true" : "false"}
                {...(row.actionPlacement === "end" || row.actionPlacement === "foot" ? { "data-grammar-action-placement": row.actionPlacement } : {})}
                {...(actionCount > 1 ? { "data-grammar-actions-multi": "true" } : {})}
                {...(hasTrail ? { "data-grammar-trail": "true" } : {})}
                {...(row.diff === undefined ? {} : { "data-grammar-diff-skeleton": row.diff })}
                {...(row.value == null ? {} : { "data-grammar-value": "true" })}
                {...(chevronOnly ? { "data-grammar-chevron-only": "true" } : {})}
                data-contract="GAP-3 PADDING-4 BOUNDARY-3 STATE-8"
            >
                {hasLeading || row.diff !== undefined ? (
                    <span className="starci-core-list-row-leading" data-grammar-leading-size={row.leading !== undefined && "state" in row.leading && row.leading.state !== undefined ? "md" : row.leading !== undefined && "size" in row.leading ? row.leading.size ?? "md" : "md"}>
                        {/* A diff row loads with the same gutter column (0.37.29): the mark's box is kept, its glyph not shown, so the loading row is the loaded row's box. */}
                        {row.diff === undefined ? null : <span className="starci-core-list-row-diff" data-grammar-diff-mark={row.diff} aria-hidden="true">{DIFF_GLYPHS[row.diff]}</span>}
                        {!hasLeading ? null : row.leading?.icon === undefined ? <Skeleton shape="circle" size="md" /> : <span className="starci-core-list-row-skeleton-tile"><Skeleton shape="rect" /></span>}
                    </span>
                ) : null}
                <span className="starci-core-list-row-copy" data-contract="GAP-1">
                    {/* The diff label's line loads as a skeleton line of the label's own type, so the loading block is the loaded block's box (0.55.0). */}
                    {row.diff === undefined ? null : <span className="starci-core-list-row-diff-label"><Skeleton shape="text" /></span>}
                    <span className="starci-core-list-row-title"><span className="starci-core-list-row-name"><Skeleton shape="text" /></span></span>
                    {row.description === undefined ? null : <span className="starci-core-list-row-description"><Skeleton shape="text" /></span>}
                    {row.diff !== "changed" || row.change === undefined ? null : <span className="starci-core-list-row-change"><Skeleton shape="text" /></span>}
                </span>
                {row.value == null ? null : <span className="starci-core-list-row-value" data-grammar-row-value="true"><Skeleton shape="text" /></span>}
                {hasTrail ? (
                    <span className="starci-core-list-row-trail">
                        {row.meta === undefined ? null : row.meta.text.trim() === ""
                            ? <span className="starci-core-list-row-meta" data-grammar-skeleton-meta="true"><Skeleton shape="text" /></span>
                            : <span className="starci-core-list-row-meta"><SkeletonPlaceholder>{row.meta.text}</SkeletonPlaceholder></span>}
                        {row.badges === undefined ? null : row.badges.every((badge) => badge.label.trim() !== "")
                            ? <span className="starci-core-list-row-badges"><SkeletonPlaceholder shape="block">{row.badges.map((badge) => <RowBadge key={badge.label} badge={badge} />)}</SkeletonPlaceholder></span>
                            : <span className="starci-core-list-row-skeleton-badge"><Skeleton shape="rect" /></span>}
                        {hasChevron ? <RowChevron /> : null}
                    </span>
                ) : null}
                {chevronOnly ? <span className="starci-core-list-row-actions"><RowChevron /></span> : null}
                {hasActions && !isFoot ? skeletonActions : null}
                {row.detail == null ? null : <div className="starci-core-list-row-detail" data-contract="GAP-3">{row.detail}</div>}
                {hasActions && isFoot ? skeletonActions : null}
            </li>
        )
    }
    return (
        <>
            <li
                className={`${staticRowClassName} starci-core-list-row`}
                data-grammar-row="true"
                data-component="ListRow"
                data-tier="composite"
                data-grammar-state={state}
                data-grammar-treatment={treatment.tone}
                data-grammar-leading={hasLeading || hasMark || row.diff !== undefined ? "true" : "false"}
                data-grammar-actions={hasActions || chevronOnly ? "true" : "false"}
                {...(row.actionPlacement === "end" || row.actionPlacement === "foot" ? { "data-grammar-action-placement": row.actionPlacement } : {})}
                {...(actionCount > 1 ? { "data-grammar-actions-multi": "true" } : {})}
                {...(hasTrail ? { "data-grammar-trail": "true" } : {})}
                {...(row.value == null ? {} : { "data-grammar-value": "true" })}
                {...(chevronOnly ? { "data-grammar-chevron-only": "true" } : {})}
                {...(row.verdict === undefined ? {} : { "data-verdict": row.verdict })}
                {...(row.edgeTone === undefined ? {} : { "data-edge-tone": row.edgeTone })}
                {...(row.emphasis === undefined ? {} : { "data-grammar-emphasis": row.emphasis })}
                {...(row.diff === undefined ? {} : { "data-grammar-diff": row.diff })}
                {...(row.onPress === undefined && row.href === undefined ? {} : { "data-grammar-row-pressable": "true" })}
                {...(drag === undefined ? {} : {
                    draggable: true,
                    "data-grammar-row-draggable": "true",
                    onDragStart: (event: DragEvent<HTMLLIElement>) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", row.id); liftRow(event); drag.onDragStart() },
                    onDragEnd: drag.onDragEnd,
                })}
                {...(drag?.isOrigin === true ? { "data-grammar-row-origin": "true" } : {})}
                {...(drag?.onMoveKey !== undefined && row.onPress === undefined && row.href === undefined ? { tabIndex: 0, ...pressKeys } : {})}
                data-grammar-row-id={row.id}
                data-contract="GAP-3 PADDING-4 BOUNDARY-3"
            >
                {drag?.keyHint === undefined ? null : <span id={hintId} hidden>{drag.keyHint}</span>}
                {drag === undefined ? null : <span className="starci-core-list-row-grip" aria-hidden="true"><Icon source={TablerGripVertical} usage="text" /></span>}
                {row.diff === undefined && row.leading === undefined && !hasMark ? null : (
                    <span className="starci-core-list-row-leading">
                        {row.diff === undefined ? null : <span className="starci-core-list-row-diff" data-grammar-diff-mark={row.diff} aria-hidden="true">{DIFF_GLYPHS[row.diff]}</span>}
                        {row.leading !== undefined ? <Leading leading={row.leading} /> : hasMark ? <StateMark state={state} /> : null}
                    </span>
                )}
                <span className="starci-core-list-row-copy" data-contract="GAP-1">
                    {/* The diff label is visible text over the value (0.55.0), read once before it; it is never struck through. */}
                    {row.diff === undefined ? null : <span className="starci-core-list-row-diff-label" data-grammar-diff-label="true">{row.diffLabel ?? DIFF_LABELS[row.diff]}</span>}
                    <span className="starci-core-list-row-title">
                        {row.emphasis !== "unread" || row.unreadLabel === undefined ? null : <span className="starci-core-visually-hidden" data-grammar-unread-label="true">{`${row.unreadLabel}: `}</span>}
                        <AgentName
                            isAgent={row.isAgent === true}
                            {...(row.agentLabel === undefined ? {} : { agentLabel: row.agentLabel })}
                            name={(
                                <span className="starci-core-list-row-name">
                                    {row.href !== undefined
                                        ? <Link variant="plain" href={row.href} {...(row.onFollow === undefined ? {} : { onFollow: row.onFollow })}>{row.title}</Link>
                                        : row.onPress === undefined
                                            ? (row.titleContent ?? row.title)
                                            : <button type="button" className="starci-core-list-row-press" data-grammar-row-press="true" onClick={row.onPress} {...pressKeys}>{row.title}</button>}
                                </span>
                            )}
                        />
                        {row.emphasis === "unread" ? <span className="starci-core-list-row-unread" data-grammar-unread-dot="true" aria-hidden="true" /> : null}
                    </span>
                    {row.description === undefined ? null : <span className="starci-core-list-row-description" data-contract="TONE-2 FONT-2" {...(typeof row.description === "string" ? {} : { "data-grammar-description-rich": "true" })}>{row.description}</span>}
                    {row.diff !== "changed" || row.change === undefined ? null : <span className="starci-core-list-row-change" data-grammar-diff-change="true">{row.change.from} <Icon source={glyphSource("arrow-end")} usage="control" /> {row.change.to}</span>}
                </span>
                {row.value == null ? null : <span className="starci-core-list-row-value" data-grammar-row-value="true">{row.value}</span>}
                {hasTrail ? (
                    <span className="starci-core-list-row-trail" data-contract="GAP-2">
                        {row.meta === undefined ? null : <span className="starci-core-list-row-meta" data-tone={row.meta.tone ?? "muted"} data-contract="FONT-2">{row.meta.text}</span>}
                        {row.badges === undefined ? null : (
                            <span className="starci-core-list-row-badges" data-contract="GAP-2">
                                {row.badges.map((badge) => <RowBadge key={badge.label} badge={badge} />)}
                            </span>
                        )}
                        {hasChevron ? <RowChevron /> : null}
                    </span>
                ) : null}
                {chevronOnly ? <span className="starci-core-list-row-actions" data-contract="GAP-2"><RowChevron /></span> : null}
                {hasActions && !isFoot ? actions : null}
                {row.detail == null ? null : <div className="starci-core-list-row-detail" data-contract="GAP-3">{row.detail}</div>}
                {/* foot (0.55.1): the commands follow the detail in the reading and focus order, on a row of their own */}
                {hasActions && isFoot ? actions : null}
            </li>
        </>
    )
}

/**
 * The one drawing of a row, inside the `Section` of rows (and a Board item card): leading mark, title with its
 * badges, one supporting line, one visible command and a menu, with an optional detail under the copy. It is an `<li>`
 * and is never rendered loose; the collection that holds it is the list.
 */
export const ListRow = withRegionLoading(ListRowInner)
