import type { StackToolingFiles } from './violating.mjs';

declare const record: {
  readonly schema: string;
  readonly description: string;
  readonly files: StackToolingFiles;
};
export default record;
