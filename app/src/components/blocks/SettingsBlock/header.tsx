import { Divider, SectionHeader } from "@starci/grammar/core"
import { SETTINGS } from "../../../modules/i18n"
import "./styles.css"

/**
 * The settings page header band: title, what the page does, a separator at its bottom. Built from existing Grammar parts in this
 * file alone, so Grammar's PageHeader replaces just this file.
 */
export const SettingsHeader = () => (
    <header className="app-settings-header" aria-label={SETTINGS.title}>
        <div className="app-settings-header-copy">
            <SectionHeader level={1} title={SETTINGS.title} description={SETTINGS.description} />
        </div>
        <Divider />
    </header>
)
