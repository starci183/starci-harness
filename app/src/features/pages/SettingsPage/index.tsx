import { Page } from "@starci/grammar/core"
import { SettingsBlock } from "../../../components/blocks/SettingsBlock"
import { SETTINGS } from "../../../modules/i18n"

/** Route `/settings` · Cài đặt: the Page headed by the title and what it does, then the settings region in its body. */
export const SettingsPage = () => (
    <Page measure="full" header={{ title: SETTINGS.title, description: SETTINGS.description }}>
        <SettingsBlock />
    </Page>
)
