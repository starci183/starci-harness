/** A tree { [file]: text } holding a loosening of `kind`, with the `detail` its finding names when given. */
export interface Form {
  readonly id: string;
  readonly file: string;
  readonly text: string;
  readonly kind: string;
  readonly detail?: string;
}
/** The same words as data or prose, which the check leaves alone. */
export interface Lookalike {
  readonly id: string;
  readonly file: string;
  readonly text: string;
}
export declare const FORBIDDEN: readonly Form[];
export declare const LOOKALIKES: readonly Lookalike[];
