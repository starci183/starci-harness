import { Page } from "@starci/grammar/core"
import { VpsFleetBlock } from "../../../components/blocks/VpsFleetBlock"
import { VPS } from "../../../modules/i18n"

/** Route `/vps` · Máy chủ VPS: the Page headed by the title and what it reads, then the fleet region in its body. */
export const VpsPage = () => (
    <Page measure="full" header={{ title: VPS.title, description: VPS.description }}>
        <VpsFleetBlock />
    </Page>
)
