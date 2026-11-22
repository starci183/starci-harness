/** A big number. */
export const NUMBER = "starci-type-display-figure"
/** The price. */
export const AMOUNT = "starci-type-display-figure"
/** The title of a card. */
export const TITLE = "starci-type-title-card"
/** A card title that grows on a tablet. */
export const NAME = "starci-type-title-card"
/** The label under a number. */
export const LABEL = "starci-type-title-section"
/** One line of a card. */
export const ITEM = "starci-type-body flex items-start gap-3"
/** A step number on a pill. */
export const STEP = "starci-type-badge rounded-full bg-accent-soft px-2"
/** A large single-step sentence: no role fits it. */
// TODO(type-role): 24px with no step: display.section or title.card
export const BIG = "text-2xl font-medium leading-8"
/** A section that opens with a statement. */
export const FACE = {
    kicker: "starci-type-display-section",
    // TODO(type-role): a 20px size stepping to 24px outside the site roles
    lead: "text-xl font-medium leading-8 md:text-2xl md:leading-9",
} as const
