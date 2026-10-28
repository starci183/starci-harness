import type { ReactNode } from "react"
import { PrimaryRailLayout } from "@starci/grammar/common"
{{blockImports}}
/** Framework-layout boundary input: the routed page of the {{segment}} segment and nothing else. */
type {{Name}}Props = { readonly content: ReactNode }

/**
 * The {{segment}} segment's frame: Grammar's PrimaryRailLayout places the routed page and {{railDoc}}. A frame only places
 * regions and never insets a page; the Page inside owns its inset and rhythm.
 */
export const {{Name}} = (props: {{Name}}Props) => {{frame}}
