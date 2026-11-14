/** The key of this file's own phantom member. */
declare const OWN_READS: unique symbol

/** Fixture: an app's own look-alike of the marker, declared outside `platform/effects`: it declares nothing to the rule. */
export interface OutsideReads<Member extends string> {
    readonly [OWN_READS]?: Member
}

/** Fixture: a port that names its reads through the look-alike: its calls stay acts. */
export interface FakeBox extends OutsideReads<"status"> {
    status(id: string): Promise<string>
}
