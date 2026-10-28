import { PageHeader } from "@starci/grammar/core"
import { SETTINGS } from "../../../modules/i18n"

/** The settings page header: title and what the page does. */
export const SettingsHeader = () => <PageHeader title={SETTINGS.title} description={SETTINGS.description} measure="full" />
