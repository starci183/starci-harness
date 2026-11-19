import type { ReactNode } from "react"
import { GrammarRoot, Link, TopBar, WorkspaceShell, type TopBarFit } from "@starci/grammar/common"

/** What the app chrome hands the shell. */
type SiteShellProps = {
    readonly brand: string
    readonly homeHref: string
    /** The bar's links and actions (`TopBar fit`): what does not fit the row moves into the menu. */
    readonly fit?: TopBarFit
    readonly children: ReactNode
}

/** The app chrome: grammar boundary, wordmark header and routed body. */
{{> fe/common/site-shell.tsx.partial}}
