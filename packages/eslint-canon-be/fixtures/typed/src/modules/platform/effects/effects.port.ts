/** How a lost act is settled (the effects piece's declaration). */
export interface EffectDeclaration {
    readonly name: string
    readonly settle: "repeatable" | "confirm" | "person"
}

/** The call of one effect: the act, and the read that confirms a lost one. */
export interface EffectCall<T> {
    readonly act: () => Promise<T>
    readonly confirm?: () => Promise<T | null>
}

/** Fixture: the one door of an act outside the database. */
export interface Effects {
    once<T>(key: string, effect: EffectDeclaration, call: EffectCall<T>): Promise<T>
}

/** The key of the phantom member `OutsideReads` carries; never set. */
declare const OUTSIDE_READS: unique symbol

/** Fixture: what a port declares as its outside READS (no intent to protect); every member it does not name is an act. */
export interface OutsideReads<Member extends string> {
    readonly [OUTSIDE_READS]?: Member
}
