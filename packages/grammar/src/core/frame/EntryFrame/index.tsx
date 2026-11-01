import type { ReactNode } from "react"

/** One entry task, with its identity and contextual artwork outside the bounded form. */
export type EntryFrameProps = {
    /** The accessible name of the page's main task. */
    readonly label: string
    /** App-owned artwork, including its decorative crop and any identity drawn over it. */
    readonly artwork: ReactNode
    /** The contextual headline and supporting copy below the artwork. */
    readonly intro: ReactNode
    /** The compact identity above the form when the artwork pane is hidden. */
    readonly identity: ReactNode
    /** Entry settings such as a language chooser; placed at the form pane's trailing top edge. */
    readonly tools: ReactNode
    /** Persistent supporting navigation below the form. */
    readonly footer: ReactNode
    /** The entry form or its outcome, held at the same centered measure in every state. */
    readonly children: ReactNode
}

/** A full-height entry task with a desktop context pane and one bounded form. */
export const EntryFrame = ({ label, artwork, intro, identity, tools, footer, children }: EntryFrameProps) => (
    <main
        aria-label={label}
        className="starci-core-entry-frame"
        data-component="EntryFrame"
        data-tier="frame"
        data-contract="LAYOUT-2 RESPONSIVE-1 PADDING-7"
    >
        <div className="starci-core-entry-context" data-grammar-entry-context="true">
            <div className="starci-core-entry-artwork" data-grammar-entry-artwork="true">{artwork}</div>
            <div className="starci-core-entry-intro" data-grammar-entry-intro="true">{intro}</div>
        </div>
        <div className="starci-core-entry-task" data-grammar-entry-task="true">
            <div className="starci-core-entry-tools" data-grammar-entry-tools="true">{tools}</div>
            <div className="starci-core-entry-center">
                <div className="starci-core-entry-identity" data-grammar-entry-identity="true">{identity}</div>
                <div className="starci-core-entry-form" data-grammar-entry-form="true">{children}</div>
            </div>
            <div className="starci-core-entry-footer" data-grammar-entry-footer="true">{footer}</div>
        </div>
    </main>
)
