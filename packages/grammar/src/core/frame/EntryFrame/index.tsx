import type { ReactNode } from "react"

/** What every entry task holds, whatever its layout. */
type EntryFrameBase = {
    /** The accessible name of the page's main task. */
    readonly label: string
    /** The brand identity: above the form on a narrow split screen, at the bar's leading edge when centred. */
    readonly identity: ReactNode
    /** Entry settings such as a language chooser; at the trailing top edge. */
    readonly tools: ReactNode
    /** Persistent supporting navigation below the form. */
    readonly footer: ReactNode
    /** The entry form or its outcome, held at the same centered measure in every state. */
    readonly children: ReactNode
}

/** `split` (the default): a desktop context pane with the app's artwork and intro beside the form pane. */
type SplitEntryFrame = EntryFrameBase & {
    readonly layout?: "split"
    /** App-owned artwork, including its decorative crop and any identity drawn over it. */
    readonly artwork: ReactNode
    /** The contextual headline and supporting copy below the artwork. */
    readonly intro: ReactNode
}

/** `centred`: no context pane; the identity and tools share one bar over the form centred on the page, the footer below it. */
type CentredEntryFrame = EntryFrameBase & {
    readonly layout: "centred"
    readonly artwork?: never
    readonly intro?: never
}

/** One entry task, with its identity outside the bounded form; split beside contextual artwork, or centred alone. */
export type EntryFrameProps = SplitEntryFrame | CentredEntryFrame

/** The task pane of a centred entry: the bar, the centred form, the footer. */
const CentredTask = ({ identity, tools, footer, children }: EntryFrameBase) => (
    <div className="starci-core-entry-task" data-grammar-entry-task="true">
        <div className="starci-core-entry-bar" data-grammar-entry-bar="true">
            <div className="starci-core-entry-bar-identity" data-grammar-entry-identity="true">{identity}</div>
            <div className="starci-core-entry-bar-tools" data-grammar-entry-tools="true">{tools}</div>
        </div>
        <div className="starci-core-entry-center">
            <div className="starci-core-entry-form" data-grammar-entry-form="true">{children}</div>
        </div>
        <div className="starci-core-entry-footer" data-grammar-entry-footer="true">{footer}</div>
    </div>
)

/** A full-height entry task: a desktop context pane beside one bounded form, or the form centred alone under a bar. */
export const EntryFrame = (props: EntryFrameProps) => (
    <main
        aria-label={props.label}
        className="starci-core-entry-frame"
        data-component="EntryFrame"
        data-tier="frame"
        data-grammar-entry-layout={props.layout === "centred" ? "centred" : "split"}
        data-contract="LAYOUT-2 RESPONSIVE-1 PADDING-7"
    >
        {props.layout === "centred" ? (
            <CentredTask label={props.label} identity={props.identity} tools={props.tools} footer={props.footer}>
                {props.children}
            </CentredTask>
        ) : (
            <>
                <div className="starci-core-entry-context" data-grammar-entry-context="true">
                    <div className="starci-core-entry-artwork" data-grammar-entry-artwork="true">{props.artwork}</div>
                    <div className="starci-core-entry-intro" data-grammar-entry-intro="true">{props.intro}</div>
                </div>
                <div className="starci-core-entry-task" data-grammar-entry-task="true">
                    <div className="starci-core-entry-tools" data-grammar-entry-tools="true">{props.tools}</div>
                    <div className="starci-core-entry-center">
                        <div className="starci-core-entry-identity" data-grammar-entry-identity="true">{props.identity}</div>
                        <div className="starci-core-entry-form" data-grammar-entry-form="true">{props.children}</div>
                    </div>
                    <div className="starci-core-entry-footer" data-grammar-entry-footer="true">{props.footer}</div>
                </div>
            </>
        )}
    </main>
)
