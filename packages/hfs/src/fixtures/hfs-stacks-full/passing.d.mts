/** The files of a repository: `hfs.json` and the YAML models as documents, every other file as text. */
export type StacksFiles = { readonly 'hfs.json': object } & { readonly [path: string]: string | object };

/** The finding codes each of the rules R266, R267, R268 and R275 is expected to report. */
export interface StacksExpectation {
  readonly R266: readonly string[];
  readonly R267: readonly string[];
  readonly R268: readonly string[];
  readonly R275: readonly string[];
}

declare const record: {
  readonly schema: string;
  readonly edition: string;
  readonly description: string;
  readonly files: StacksFiles;
  readonly expect: StacksExpectation;
};
export default record;
