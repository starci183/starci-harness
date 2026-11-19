import type { ReactNode } from "react"

export type FragmentProps = {
    /** The app's own markup, code and libraries. Rendered as they are: Fragment adds no element. */
    readonly children?: ReactNode
    /**
     * Why no Grammar component fits, in a few words (for example "workflow graph editor"). Required: Fragment is a last resort,
     * and the reason is the audit trail. With no element there is nothing to stamp: it serves the lint and the inventory.
     */
    readonly reason: string
}

/**
 * The sanctioned escape hatch: a region where anything goes, like React's Fragment it renders no wrapper element, only its
 * children. Inside it the app writes any markup and any class name and uses any library (a graph editor, an animation library,
 * a chart toolkit), because no Grammar component fits. The Grammar lint rules report nothing inside it, the rest of the page
 * still follows the Grammar, and every use is listed by the Fragment inventory (`starci-fragment-inventory`). A file that also
 * needs React's Fragment imports this one as `import { Fragment as GrammarFragment } from "@starci/grammar"`.
 */
export const Fragment = ({ children }: FragmentProps) => <>{children}</>
