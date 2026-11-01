import type { ReactNode } from "react"
import { Stack } from "@starci/grammar/common"

/** What {{Name}} holds: it owns a region and lays out whatever its caller puts in it. */
type {{Name}}Props = {
    readonly children: ReactNode
}

/** A frame owns a region of the screen and adds no content of its own; only a frame takes `children`. */
export const {{Name}} = (props: {{Name}}Props) => <Stack gap="section">{props.children}</Stack>
