import { SectionHeader } from "@starci/grammar/core"
import { SettingsBlock } from "../../../components/blocks/SettingsBlock"
import { SETTINGS } from "../../../modules/i18n"

/** Route `/settings` · Cài đặt: the page title, then the settings region. */
export const SettingsPage = () => (
    <div className="app-page-stack">
        <SectionHeader level={1} title={SETTINGS.title} description={SETTINGS.description} />
        <SettingsBlock />
    </div>
)
