import type { ReactNode } from "react"
import { GrammarRoot, Link, TopBar, WorkspaceShell } from "@starci/grammar/common"

/** What the app chrome hands the shell. */
type SiteShellProps = {
    readonly brand: string
    readonly homeHref: string
    readonly children: ReactNode
}

/** The app chrome: grammar boundary, wordmark header and routed body. */
{{> fe/common/site-shell.tsx.partial}}
