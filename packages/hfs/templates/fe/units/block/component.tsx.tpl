import { SurfaceCard, Text } from "@starci/grammar/common"
import { SlotView } from "{{slotViewFrom}}"
import type { DataSlot, SlotLabels } from "@/modules/types"
{{shapeDeclarations}}
/** One read value as {{Name}} draws it. */
export interface {{Name}}Item {
    readonly id: string
{{itemShapeMember}}}

/** Copy, the one read and the retry the connected {{Name}} supplies; atoms only. */
export interface {{Name}}BaseProps {
{{shapeMember}}    readonly props: {
        readonly title: string
{{shapeLabelsMember}}        readonly item: DataSlot<{{Name}}Item>
        readonly slotLabels: SlotLabels
    }
    readonly on: { readonly retry: () => void }
}

/** A value of the same shape as the read: the skeleton draws the ready tree from it{{placeholderShapeDoc}}. */
export const {{NAME_UPPER}}_PLACEHOLDER: {{Name}}Item = { id: ""{{placeholderShape}} }
{{shapeBody}}
/** Draws {{Name}} from atoms: its read renders every status through SlotView, inside the unchanged surface. */
export const {{Name}}Base = (props: {{Name}}BaseProps) => (
    <SurfaceCard label={props.props.title}>
        <SlotView
            slot={props.props.item}
            placeholder={{{NAME_UPPER}}_PLACEHOLDER}
            labels={props.props.slotLabels}
            onRetry={props.on.retry}
        >
            {(item, isSkeleton) => {{readyTree}}}
        </SlotView>
    </SurfaceCard>
)
