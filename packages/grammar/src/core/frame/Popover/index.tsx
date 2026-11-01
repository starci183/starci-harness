import { PopoverPart, type PopoverPlacement, type PopoverProps } from "../../PopoverPart.js"

export type { PopoverPlacement, PopoverProps }

/** FRAME - `Popover`: rich, interactive content anchored to a trigger; see `PopoverPart` for the mechanics. */
export const Popover = (props: PopoverProps) => <PopoverPart {...props} stamp="frame" />
