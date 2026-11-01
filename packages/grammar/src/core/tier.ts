/**
 * What a component of each tier may take as `children` (the tier ladder: leaf, branch, composite, frame).
 *
 * A frame owns a region and draws what its caller places in it, so it alone declares `children: ReactNode`. A leaf's
 * label is text and nothing else. A branch or composite draws a fixed anatomy from fields and named slots, so nested
 * JSX under it is a compile error for every caller, not a style the lint has to find. `starci-grammar/tier-props`
 * requires one of these on the public props type of every component outside a frame.
 */

/** The props of a component that takes no children: its anatomy is its fields and named slots. */
export type NoChildren = { readonly children?: never }

/** The props of a leaf whose only child is its text label. Nested JSX does not compile. */
export type LabelChild = { readonly children?: string }
