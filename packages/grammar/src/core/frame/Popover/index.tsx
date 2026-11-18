import { PopoverPart, type PopoverPlacement, type PopoverProps, type PopoverSize } from "../../PopoverPart.js"

export type { PopoverPlacement, PopoverProps, PopoverSize }

/** FRAME - `Popover`: rich, interactive content anchored to a trigger; see `PopoverPart` for the mechanics. */
export const Popover = (props: PopoverProps) => <PopoverPart {...props} stamp="frame" />
