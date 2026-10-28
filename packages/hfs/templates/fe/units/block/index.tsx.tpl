"use client"

import { useTranslations } from "next-intl"
import { mapSlot, slotOfSwr, useSlotLabels } from "@/hooks/slot"
import { useQuery{{Read}}Swr } from "@/hooks/swr"
import { {{componentImports}} } from "./component"
{{componentTypeImport}}
/** Input of {{Name}}: the id of the value it reads. */
type {{Name}}Props = {
    readonly id: string
}
{{shapeOfHelper}}
/** The connected {{Name}}: folds its one read into a slot, {{connectedDoc}}resolves every label and the retry, and renders its pure half. */
export const {{Name}} = (props: {{Name}}Props) => {
    const t = useTranslations("{{nameCamel}}")
    const slotLabels = useSlotLabels()
    const read = useQuery{{Read}}Swr(props.id)
    const item = mapSlot(slotOfSwr(read), (value) => ({ id: value.id{{itemShapeMapped}} }))
    return (
        <{{Name}}Base
{{shapeAttribute}}            props={{
                title: t("title"),
{{shapeLabelsResolved}}                item,
                slotLabels: slotLabels(t("empty")),
            }}
            on={{ retry: () => void read.mutate() }}
        />
    )
}
