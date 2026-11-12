export type SublabelProps = {
    /** The group label: one short line naming the card or group beneath it ("Allowed to act alone"). */
    readonly children: string
    readonly id?: string
}

/**
 * LEAF - `Sublabel`: the group label that sits above a card inside a section, at the small step (12), weight 500, muted.
 * It names what the card under it holds, one level below the section's own heading; it is not a heading and joins no outline.
 * Apps never hand-roll it with a Text size and a weight.
 * Contract: FONT-1 TONE-2.
 */
export const Sublabel = ({ children, id }: SublabelProps) => (
    <div
        {...(id === undefined ? {} : { id })}
        className="starci-core-sublabel"
        data-component="Sublabel"
        data-tier="leaf"
        data-contract="FONT-1 TONE-2"
    >
        {children}
    </div>
)
