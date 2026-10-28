import { SettingsBlock } from "../../../components/blocks/SettingsBlock"
import { SettingsHeader } from "../../../components/blocks/SettingsBlock/header"

/** Route `/settings` · Cài đặt: the page header band, then the settings region. */
export const SettingsPage = () => (
    <div className="app-page-stack">
        <SettingsHeader />
        <SettingsBlock />
    </div>
)
