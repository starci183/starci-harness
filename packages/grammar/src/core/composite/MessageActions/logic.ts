/**
 * The pure rules of the message hover rail: which side it stands on, where the reaction picker opens, and the emoji it offers.
 * No React and no DOM, so the specs read them directly.
 */

/** `incoming`: someone else's or an agent's message (left); `outgoing`: the viewer's own (right). The same two sides as `MessageBubble`. */
export type MessageActionsSide = "incoming" | "outgoing"

/** The reaction picker's emoji, in the owner's order (2026-11-21). */
export const MESSAGE_REACTION_PICKER_EMOJI: readonly string[] = Object.freeze(["❤️", "😆", "😮", "😢", "😡", "👍"])

/**
 * Which edge of the bubble the rail stands beside: the END of an incoming bubble, the START of an outgoing one (logical, so a right-to-left page
 * mirrors it). The rail is always on the side away from the avatar.
 */
export const messageActionsEdge = (side: MessageActionsSide): "end" | "start" => side === "incoming" ? "end" : "start"

/**
 * Where the reaction picker opens: ABOVE the react button, its end edge on the button's end for an incoming message (it grows toward the start, over
 * the bubble) and its start edge on the button's start for an outgoing one (it grows toward the end, over the bubble).
 */
export const messageActionsPickerPlacement = (side: MessageActionsSide): "top end" | "top start" => side === "incoming" ? "top end" : "top start"

/** The menu opens below its dots button, on the bubble's side, so it never covers the bubble it acts on. */
export const messageActionsMenuPlacement = (side: MessageActionsSide): "bottom end" | "bottom start" => side === "incoming" ? "bottom end" : "bottom start"
