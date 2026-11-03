// The types of runtime/scripts/lib/declaration-surface.mjs.

/** One export (or part of one) the declaration emit cannot write without inference. */
export interface SurfaceProblem {
  readonly code: number
  readonly start: number
  readonly length: number
  readonly name: string
  readonly annotate: string
  readonly reason: string
}

/** The declaration emit of one file and the exports it could not write explicitly. */
export interface DeclarationSurface {
  readonly outputText: string
  readonly problems: SurfaceProblem[]
}

/** A script file: it has no declaration emit. */
export declare const SCRIPT: RegExp
/** A declaration file: it is its own surface. */
export declare const DECLARATION: RegExp
/** A TypeScript source file. */
export declare const TYPESCRIPT: RegExp
/** Whether `file` is a TypeScript source (not a declaration file) the declaration emit reads. */
export declare const isEmittableSource: (file: string) => boolean
/** The declaration emit of a TypeScript source and its problems, or null when the compiler has no `transpileDeclaration`. */
export declare const declarationSurface: (ts: typeof import("typescript"), file: string, text: string, module?: number) => DeclarationSurface | null
