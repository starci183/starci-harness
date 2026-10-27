"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { useQueryLeadsSwr } from "@/hooks/swr/api/graphql/queries/useQueryLeadsSwr"
import { useQueryOwnersSwr } from "@/hooks/swr/api/graphql/queries/useQueryOwnersSwr"
import { useSlotLabels } from "@/hooks/slot"
import { slotOfSwr } from "@/hooks/slot/slot.shared"
import { LeadBoardBlockBase } from "./component"
import type { LeadBoardBlockShape } from "./component"

/**
 * The connected lead board: folds the leads and owners reads into their slots, resolves the copy and keeps the shape the
 * reader chose. The two read hooks and the status labels hook are the app's; this fixture holds only what the stories
 * check reads.
 */
export const LeadBoardBlock = () => {
    const t = useTranslations("leads")
    const labels = useSlotLabels()
    const leads = useQueryLeadsSwr()
    const owners = useQueryOwnersSwr()
    const [shape, setShape] = useState<LeadBoardBlockShape>("list")
    return (
        <LeadBoardBlockBase
            shape={shape}
            props={{
                title: t("title"),
                ownersTitle: t("ownersTitle"),
                shapeLabels: { list: t("shape.list"), stages: t("shape.stages"), unassigned: t("shape.unassigned") },
                leads: slotOfSwr(leads, leads.isForbidden),
                owners: slotOfSwr(owners, owners.isForbidden),
                leadsLabels: labels,
                ownersLabels: labels,
            }}
            on={{ show: setShape, retryLeads: () => void leads.mutate(), retryOwners: () => void owners.mutate() }}
        />
    )
}
