"use client"

import { useIsLoading } from "../../regionScope.js"
import { Button as HeroButton, Popover as HeroPopover } from "@heroui/react"
import { useState } from "react"
import { DropdownMenu, type DropdownMenuEntry } from "../../branch/DropdownMenu/index.js"
import { Icon } from "../../leaf/Icon/index.js"
import { overlayOpenProps, useOverlayContainer } from "../../overlayScope.js"
import type { NoChildren } from "../../tier.js"
import { MESSAGE_REACTION_PICKER_EMOJI, messageActionsEdge, messageActionsMenuPlacement, messageActionsPickerPlacement, type MessageActionsSide } from "./logic.js"
import { TablerArrowBackUp, TablerDotsVertical, TablerMoodSmile, TablerPlus } from "../../leaf/Icon/tabler.js"

export { MESSAGE_REACTION_PICKER_EMOJI, messageActionsEdge, messageActionsMenuPlacement, messageActionsPickerPlacement, type MessageActionsSide } from "./logic.js"

/** Every name the rail speaks, passed in by the app (its i18n): Grammar writes no sentence. */
export type MessageActionsLabels = {
    /** The react button, e.g. "Bày tỏ cảm xúc". */
    readonly react: string
    /** The reply button, e.g. "Trả lời". */
    readonly reply: string
    /** The dots button that opens the menu, e.g. "Thêm". */
    readonly more: string
    /** The name of the floating emoji picker. */
    readonly picker: string
    /** One emoji button, from the emoji, e.g. "Bày tỏ ❤️". */
    readonly reactWith: (emoji: string) => string
    /** The "+" at the end of the picker that opens the full picker. */
    readonly allEmoji: string
}

export type MessageActionsProps = NoChildren & {
    /** `incoming` (someone else's or an agent's message): the rail stands on the end of the bubble. `outgoing` (the viewer's own): on its start. */
    readonly side: MessageActionsSide
    readonly labels: MessageActionsLabels
    /** The viewer picked an emoji. The picker closes; the app persists and draws the chip (`MessageBubble reactions`). */
    readonly onReact: (emoji: string) => void
    /** The "+" of the picker: the app opens its full emoji picker. Omitted, the picker has no "+". */
    readonly onMore?: () => void
    /** The reply button; omitted, no reply button. */
    readonly onReply?: () => void
    /** The items of the dots menu (the app's: copy, pin, recall, create a task...). Omitted or empty, no dots button. */
    readonly menu?: ReadonlyArray<DropdownMenuEntry>
    readonly onMenuAction?: (id: string) => void
    /** The emoji the viewer already chose on this message; it is pressed in the picker. */
    readonly reaction?: string
    /** Shows the rail whatever the pointer does (a long press on touch sets it). An open picker, an open menu and keyboard focus inside show it too. */
    readonly isVisible?: boolean
    /** The picker's emoji; the owner's six when omitted. */
    readonly emoji?: ReadonlyArray<string>
}

/** What `MessageBubble messageActions` takes: everything but the side, which the bubble knows. */
export type MessageActionsConfig = Omit<MessageActionsProps, "side" | "isVisible">

const ACTION = { variant: "ghost", size: "sm", isIconOnly: true } as const

/**
 * The hover rail of a chat message (owner, 2026-11-21, after Messenger): react, reply and more, each HeroUI's own ghost `sm` icon-only Button
 * with a 16px icon, used as shipped. It is bare: no border and no fill until the ghost hover fill; the open trigger keeps that fill. The rail stands on
 * the side of the bubble away from the avatar, about 10px off it and centred on it, and is shown on hover, on a long press (touch) or on keyboard
 * focus inside the message, with a 120ms opacity fade that does not move under reduced motion. React opens a floating popover pill above its
 * button (popover shadow, no border, fully rounded) with six emoji and a "+"; an outside press or Esc closes it. More opens the app's menu.
 * Place it in `MessageBubble messageActions`, or in any row marked `data-grammar-message-actions-host`. It draws nothing while its region loads.
 * Contract: A11Y-2 (every button named by the app's label); picker FOCUS-3 MOTION-2.
 */
const MessageActionsInner = ({ side, labels, onReact, onMore, onReply, menu, onMenuAction, reaction, isVisible = false, emoji = MESSAGE_REACTION_PICKER_EMOJI }: MessageActionsProps) => {
    const [pickerOpen, setPickerOpen] = useState(false)
    const [menuOpen, setMenuOpen] = useState(false)
    const { anchor, container } = useOverlayContainer("MessageActions")
    const hasMenu = menu !== undefined && menu.length > 0
    const choose = (picked: string) => { setPickerOpen(false); onReact(picked) }
    return (
        <div
            className="starci-core-message-actions"
            data-component="MessageActions"
            data-contract="A11Y-2 FOCUS-3 MOTION-2"
            data-tier="composite"
            data-grammar-message-actions-edge={messageActionsEdge(side)}
            data-grammar-message-actions-side={side}
            data-grammar-message-actions-open={pickerOpen || menuOpen ? "true" : "false"}
            data-grammar-message-actions-visible={isVisible ? "true" : "false"}
        >
            {anchor}
            <HeroPopover {...overlayOpenProps({ isOpen: pickerOpen, onOpenChange: setPickerOpen })}>
                <HeroButton {...ACTION} aria-label={labels.react} data-grammar-message-action="react"><Icon source={TablerMoodSmile} usage="control" /></HeroButton>
                {container === null ? null : (
                    <HeroPopover.Content
                        UNSTABLE_portalContainer={container}
                        placement={messageActionsPickerPlacement(side)}
                        offset={4}
                        className="starci-core-message-reactions"
                        data-grammar-overlay-surface="popover"
                        data-grammar-message-reactions="true"
                        data-contract="FOCUS-3 MOTION-2"
                    >
                        <HeroPopover.Dialog aria-label={labels.picker} className="starci-core-message-reactions-dialog">
                            {emoji.map((item) => (
                                <button
                                    key={item}
                                    aria-label={labels.reactWith(item)}
                                    {...(reaction === undefined ? {} : { "aria-pressed": reaction === item })}
                                    className="starci-core-message-reactions-emoji"
                                    data-grammar-message-emoji={item}
                                    onClick={() => choose(item)}
                                    type="button"
                                ><span aria-hidden="true">{item}</span></button>
                            ))}
                            {onMore === undefined ? null : (
                                <button
                                    aria-label={labels.allEmoji}
                                    className="starci-core-message-reactions-more"
                                    data-grammar-message-emoji-more="true"
                                    onClick={() => { setPickerOpen(false); onMore() }}
                                    type="button"
                                ><Icon source={TablerPlus} usage="control" /></button>
                            )}
                        </HeroPopover.Dialog>
                    </HeroPopover.Content>
                )}
            </HeroPopover>
            {onReply === undefined ? null : (
                <HeroButton {...ACTION} aria-label={labels.reply} data-grammar-message-action="reply" onPress={onReply}><Icon source={TablerArrowBackUp} usage="control" /></HeroButton>
            )}
            {!hasMenu ? null : (
                <DropdownMenu
                    entries={menu}
                    isOpen={menuOpen}
                    onOpenChange={setMenuOpen}
                    placement={messageActionsMenuPlacement(side)}
                    {...(onMenuAction === undefined ? {} : { onAction: onMenuAction })}
                    trigger={<HeroButton {...ACTION} aria-label={labels.more} data-grammar-message-action="more"><Icon source={TablerDotsVertical} usage="control" /></HeroButton>}
                />
            )}
        </div>
    )
}

const MessageActionsGate = (props: MessageActionsProps) => useIsLoading(undefined) ? null : <MessageActionsInner {...props} />

/** The hover rail of a chat message: react, reply and more as ghost icon buttons. The whole behaviour is described on `MessageActionsInner` above. */
export const MessageActions = MessageActionsGate
