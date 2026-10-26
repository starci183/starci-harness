import type { ZodType } from "zod"

/** Type declarations; execution belongs to the emit and example suites. */
export declare const PlanInputSchema: ZodType<{ readonly id: string }>
export declare const PlanOutputSchema: ZodType<{ readonly ok: boolean }>
export declare const EmptyInputSchema: ZodType<Record<string, never>>
export declare const CoercedInputSchema: ZodType<{ readonly id: string }, { readonly id: unknown }>
export declare const UnknownParsedSchema: ZodType<unknown, { readonly id: string }>
export declare const AnyParsedSchema: ZodType<any, { readonly id: string }>
export declare const DateParsedSchema: ZodType<Date, { readonly id: string }>
export declare const OptionalParsedSchema: ZodType<string | undefined>
export declare const UndefinedParsedSchema: ZodType<undefined, string>
export declare const VoidParsedSchema: ZodType<void, string>
export declare const MaybeUndefinedParsedSchema: ZodType<string | undefined, string>
export declare const MaybeVoidParsedSchema: ZodType<string | void, string>
export declare const NestedOptionalSchema: ZodType<{ readonly id?: string }>
export declare const DefaultedParsedSchema: ZodType<string, string | undefined>
export declare const NeverParsedSchema: ZodType<never, string>

/** A schema-shaped impostor has no zod parser provenance. */
export declare const FakeInputSchema: { safeParse(value: unknown): { success: boolean }; readonly _input: { readonly id: string }; readonly _output: { readonly id: string } }
