"use client"

import { withRegionGeometry } from "../../regionScope.js"
import { CheckIcon } from "@heroicons/react/16/solid"
import { CheckCircleIcon } from "@heroicons/react/24/outline"
import { Icon } from "../../leaf/Icon/index.js"
import type { NoChildren } from "../../tier.js"
import { AvatarGroup } from "../AvatarGroup/index.js"

/** People authority reports have read the message; the app supplies localized overflow copy. */
export type MessageStatusReaders = {
    readonly items: ReadonlyArray<{ readonly id: string; readonly name: string; readonly src?: string }>
    /** Accessible copy for readers beyond the visible avatars. */
    readonly overflowLabel: string
    /** Additional readers outside the supplied list, already formatted by the app. */
    readonly moreLabel?: string
}

/** One authority-owned message receipt or transport outcome, independent of how a message body is rendered. */
export type MessageStatusProps = NoChildren & { readonly label: string } & (
    | { readonly kind: "receipt"; readonly state: "sent" | "delivered"; readonly readers?: never }
    | { readonly kind: "receipt"; readonly state: "seen"; readonly readers?: MessageStatusReaders }
    | { readonly kind: "transport"; readonly state: "queued" | "sent" | "failed" | "unknown"; readonly readers?: never }
)

const READERS_SHOWN = 3

/** Reports a message's actual delivery or read state with native marks and a polite atomic announcement. */
const MessageStatusInner = (props: MessageStatusProps) => {
    const readers = props.kind === "receipt" && props.state === "seen" ? props.readers : undefined
    return (
        <div className="starci-core-message-status" data-component="MessageStatus" data-tier="composite"
            data-grammar-message-status={props.kind} data-grammar-message-status-state={props.state}>
            <span className="starci-core-message-status-label" aria-live="polite" aria-atomic="true">
                {props.kind === "receipt" ? <Icon source={props.state === "delivered" ? CheckCircleIcon : CheckIcon} usage="chip" /> : null}
                {props.kind === "receipt" && props.state === "seen" ? <Icon source={CheckIcon} usage="chip" /> : null}
                {props.label}
            </span>
            {readers === undefined || readers.items.length === 0 ? null : (
                <AvatarGroup label={props.label} size="sm" max={READERS_SHOWN}
                    items={readers.items.map((reader) => ({ ...reader, seed: reader.id }))}
                    overflowLabel={() => readers.overflowLabel} />
            )}
            {readers?.moreLabel === undefined ? null : <span className="starci-core-message-status-more-readers">{readers.moreLabel}</span>}
        </div>
    )
}

/** Reports a message's actual delivery or read state with native marks and a polite atomic announcement. */
export const MessageStatus = withRegionGeometry(MessageStatusInner, "text")
