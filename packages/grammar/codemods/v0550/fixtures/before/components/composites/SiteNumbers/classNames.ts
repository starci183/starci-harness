/** A big number. */
export const NUMBER = "text-4xl font-medium tracking-tight md:text-6xl"
/** The price. */
export const AMOUNT = "text-[2.75rem] leading-none font-medium tracking-[-0.04em] lg:text-[3.5rem]"
/** The title of a card. */
// TODO(type-role): 16-18px outside a heading
export const TITLE = "text-lg font-medium"
/** A card title that grows on a tablet. */
export const NAME = "text-lg font-medium tracking-[-0.01em] md:text-xl"
/** The label under a number. */
export const LABEL = "text-base font-medium"
/** One line of a card. */
export const ITEM = "flex items-start gap-3 text-[0.9375rem]"
/** A step number on a pill. */
export const STEP = "rounded-full bg-accent-soft px-2 text-xs font-medium"
/** A large single-step sentence: no role fits it. */
export const BIG = "text-2xl font-medium leading-8"
/** A section that opens with a statement. */
export const FACE = {
    kicker: "text-2xl font-medium leading-9 md:text-3xl md:leading-10",
    lead: "text-xl font-medium leading-8 md:text-2xl md:leading-9",
} as const
