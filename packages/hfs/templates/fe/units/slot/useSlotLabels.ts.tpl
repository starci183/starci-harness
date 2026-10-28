import { useTranslations } from "next-intl"
import type { SlotLabels } from "@/modules/types"

/** Resolves the shared status copy once; the returned function adds one region's own empty sentence. */
export const useSlotLabels = () => {
    const t = useTranslations("status")
    return (empty: string): SlotLabels => ({ empty, forbidden: t("forbidden"), error: t("error"), retry: t("retry") })
}
