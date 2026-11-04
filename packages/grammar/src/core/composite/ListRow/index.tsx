"use client"

import { withRegionLoading } from "../../regionScope.js"
import { useId, type DragEvent, type KeyboardEvent } from "react"
import { ButtonPlacementProvider } from "../../buttonIntent.js"
import { staticRowClassName } from "../../classNames.js"
import { LeadingNumber } from "../../LeadingNumber.js"
import { StateMark } from "../../StateMark.js"
import { treatmentFor } from "../../state.js"
import { DropdownMenu } from "../../branch/DropdownMenu/index.js"
import { Avatar } from "../../leaf/Avatar/index.js"
import { Badge } from "../../leaf/Badge/index.js"
import { Button } from "../../leaf/Button/index.js"
import { IconButton } from "../../leaf/IconButton/index.js"
import { IconTile } from "../../leaf/IconTile/index.js"
import { Link } from "../../leaf/Link/index.js"
import { Skeleton } from "../../leaf/Skeleton/index.js"
import { EllipsisHorizontalIcon } from "@heroicons/react/16/solid"
import type { NoChildren } from "../../tier.js"
import type { BadgeData, ItemAction, ItemLeading, ListRowData } from "../../surfaceCardData.js"

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
    if (leading.avatar !== undefined) return <Avatar {...leading.avatar} size="sm" isDecorative />
    if (leading.icon !== undefined) return <IconTile source={leading.icon} size="sm" />
    return <LeadingNumber position={leading.position} />
}

const RowBadge = ({ badge }: { readonly badge: BadgeData }) => (
    badge.isDot === true
        ? <Badge isDot tone={badge.tone ?? "neutral"}>{badge.label}</Badge>
        : <Badge tone={badge.tone ?? "neutral"}>{badge.label}</Badge>
)

const RowAction = ({ action }: { readonly action: ItemAction }) => {
    const intent = action.intent === "destructive"
        ? { intent: "destructive" as const, step: "entry" as const }
        : { intent: action.intent ?? "neutral" }
    return action.href === undefined
        ? <Button size="sm" {...intent} isDisabled={action.isDisabled === true} isPending={action.isPending === true} onPress={action.press}>{action.label}</Button>
        : <Button size="sm" {...intent} isDisabled={action.isDisabled === true} isPending={action.isPending === true} href={action.href}>{action.label}</Button>
}

/**
 * The one drawing of a row, inside `SurfaceCard kind="list"` and the `Section` of rows: leading mark, title with its
 * badges, one supporting line, one visible command and a menu, with an optional detail under the copy. It is an `<li>`
 * and is never rendered loose; the collection that holds it is the list.
 */
const ListRowInner = ({ row, isLoading = false }: ListRowProps) => {
    const state = row.state ?? "neutral"
    const treatment = treatmentFor(state)
    const hasLeading = row.leading !== undefined
    const hasMark = !hasLeading && treatment.mark === "check"
    const hasActions = row.action !== undefined || row.menu !== undefined
    const hasTrail = row.meta !== undefined || row.badges !== undefined
    const drag = row.drag
    const hintId = useId()
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
                data-grammar-leading={hasLeading ? "true" : "false"}
                data-grammar-actions={hasActions ? "true" : "false"}
                {...(hasTrail ? { "data-grammar-trail": "true" } : {})}
                data-contract="GAP-3 PADDING-4 BOUNDARY-3 STATE-8"
            >
                {hasLeading ? <span className="starci-core-list-row-leading"><Skeleton shape="circle" size="md" /></span> : null}
                <span className="starci-core-list-row-copy" data-contract="GAP-1">
                    <span className="starci-core-list-row-title"><span className="starci-core-list-row-name"><Skeleton shape="text" /></span></span>
                    {row.description === undefined ? null : <span className="starci-core-list-row-description"><Skeleton shape="text" /></span>}
                </span>
                {hasTrail ? (
                    <span className="starci-core-list-row-trail">
                        {row.meta === undefined ? null : <span className="starci-core-list-row-meta" data-grammar-skeleton-meta="true"><Skeleton shape="text" /></span>}
                        {row.badges === undefined ? null : <span className="starci-core-list-row-skeleton-badge"><Skeleton shape="rect" /></span>}
                    </span>
                ) : null}
                {hasActions ? <span className="starci-core-list-row-actions"><span className="starci-core-list-row-skeleton-action"><Skeleton shape="rect" /></span></span> : null}
                {row.detail == null ? null : <div className="starci-core-list-row-detail" data-contract="GAP-3">{row.detail}</div>}
            </li>
        )
    }
    return (
        <ButtonPlacementProvider placement="item">
            <li
                className={`${staticRowClassName} starci-core-list-row`}
                data-grammar-row="true"
                data-component="ListRow"
                data-tier="composite"
                data-grammar-state={state}
                data-grammar-treatment={treatment.tone}
                data-grammar-leading={hasLeading || hasMark ? "true" : "false"}
                data-grammar-actions={hasActions ? "true" : "false"}
                {...(hasTrail ? { "data-grammar-trail": "true" } : {})}
                {...(row.verdict === undefined ? {} : { "data-verdict": row.verdict })}
                {...(row.onPress === undefined ? {} : { "data-grammar-row-pressable": "true" })}
                {...(drag === undefined ? {} : {
                    draggable: true,
                    "data-grammar-row-draggable": "true",
                    onDragStart: (event: DragEvent<HTMLLIElement>) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", row.id); drag.onDragStart() },
                    onDragEnd: drag.onDragEnd,
                })}
                {...(drag?.onMoveKey !== undefined && row.onPress === undefined && row.href === undefined ? { tabIndex: 0, ...pressKeys } : {})}
                data-grammar-row-id={row.id}
                data-contract="GAP-3 PADDING-4 BOUNDARY-3"
            >
                {drag?.keyHint === undefined ? null : <span id={hintId} hidden>{drag.keyHint}</span>}
                {row.leading !== undefined
                    ? <span className="starci-core-list-row-leading"><Leading leading={row.leading} /></span>
                    : hasMark ? <span className="starci-core-list-row-leading"><StateMark state={state} /></span> : null}
                <span className="starci-core-list-row-copy" data-contract="GAP-1">
                    <span className="starci-core-list-row-title">
                        <span className="starci-core-list-row-name">
                            {row.href !== undefined
                                ? <Link href={row.href} {...(row.onFollow === undefined ? {} : { onFollow: row.onFollow })}>{row.title}</Link>
                                : row.onPress === undefined
                                    ? row.title
                                    : <button type="button" className="starci-core-list-row-press" data-grammar-row-press="true" onClick={row.onPress} {...pressKeys}>{row.title}</button>}
                        </span>
                    </span>
                    {row.description === undefined ? null : <span className="starci-core-list-row-description" data-contract="TONE-2 FONT-2">{row.description}</span>}
                </span>
                {hasTrail ? (
                    <span className="starci-core-list-row-trail" data-contract="GAP-2">
                        {row.meta === undefined ? null : <span className="starci-core-list-row-meta" data-tone={row.meta.tone ?? "muted"} data-contract="FONT-2">{row.meta.text}</span>}
                        {row.badges === undefined ? null : (
                            <span className="starci-core-list-row-badges" data-contract="GAP-2">
                                {row.badges.map((badge) => <RowBadge key={badge.label} badge={badge} />)}
                            </span>
                        )}
                    </span>
                ) : null}
                {hasActions ? (
                    <span className="starci-core-list-row-actions" data-contract="GAP-2">
                        {row.action === undefined ? null : <RowAction action={row.action} />}
                        {row.menu === undefined ? null : (
                            <DropdownMenu
                                placement="bottom end"
                                entries={row.menu.entries}
                                trigger={<IconButton label={row.menu.label} source={EllipsisHorizontalIcon} intent="neutral" />}
                            />
                        )}
                    </span>
                ) : null}
                {row.detail == null ? null : <div className="starci-core-list-row-detail" data-contract="GAP-3">{row.detail}</div>}
            </li>
        </ButtonPlacementProvider>
    )
}

/**
 * The one drawing of a row, inside `SurfaceCard kind="list"` and the `Section` of rows: leading mark, title with its
 * badges, one supporting line, one visible command and a menu, with an optional detail under the copy. It is an `<li>`
 * and is never rendered loose; the collection that holds it is the list.
 */
export const ListRow = withRegionLoading(ListRowInner)
