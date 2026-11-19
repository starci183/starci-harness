import type { ReactNode } from "react"
import { GrammarRoot, Link, TopBar, WorkspaceShell, type TopBarFit } from "@starci/grammar/common"

/** What an app's chrome hands the shell: the brand, its home link and the routed body. */
type SiteShellProps = {
    /** The wordmark; it also names the page's main landmark. */
    readonly brand: string
    /** The destination of the wordmark: the app's front door. */
    readonly homeHref: string
    /** The bar's links and actions as data (`TopBar fit`): what does not fit the row moves into the three-line menu; never a hand-built row. */
    readonly fit?: TopBarFit
    /** The routed page body. */
    readonly children: ReactNode
}

/**
 * The document chrome both apps share: Grammar's Common boundary, the brand header (the top bar carrying the wordmark that links
 * home), then the routed body in the shell's main landmark (each page draws its own measure).
 */
{{> fe/common/site-shell.tsx.partial}}
