import { PageContainer } from "@starci/grammar/core"
import { SettingsBlock } from "../../../components/blocks/SettingsBlock"
import { SettingsHeader } from "../../../components/blocks/SettingsBlock/header"

/** Route `/settings` · Cài đặt: the page header flush at the top, then the settings region in the page body. */
export const SettingsPage = () => (
    <>
        <SettingsHeader />
        <PageContainer measure="full" className="app-page-body">
            <SettingsBlock />
        </PageContainer>
    </>
)
