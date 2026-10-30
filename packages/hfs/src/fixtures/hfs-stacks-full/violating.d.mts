import type { StacksExpectation, StacksFiles } from './passing.mjs';

declare const record: {
  readonly schema: string;
  readonly edition: string;
  readonly description: string;
  readonly files: StacksFiles;
  readonly expect: StacksExpectation;
};
export default record;
