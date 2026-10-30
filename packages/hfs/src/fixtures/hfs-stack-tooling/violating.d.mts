/** The files a stack-tooling fixture app writes: the two JSON documents and the text of every other file. */
export type StackToolingFiles = {
  readonly 'hfs.json': { readonly hfs: number; readonly kind: string; readonly project: string };
  readonly 'package.json': { readonly name: string; readonly scripts: Readonly<Record<string, string>> };
} & { readonly [path: string]: string | object };

/** A finding expected of a file: the path and the canon verb it re-implements. */
export interface StackToolingExpectation {
  readonly path: string;
  readonly verb: string;
}

declare const record: {
  readonly schema: string;
  readonly description: string;
  readonly files: StackToolingFiles;
  readonly expect: readonly StackToolingExpectation[];
};
export default record;
