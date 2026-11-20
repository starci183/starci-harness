// tsc-launch.mts - `tsc` of an app with the build artifacts its include globs reach hidden (runtime/scripts/hfs/program-artifacts.mts): the types family runs it
// in place of the tsc bin when a program's tsconfig reaches one, so the program is the one a clean checkout builds. It is TypeScript's own command line
// (`executeCommandLine` of the app's typescript, the same code the bin runs), over a system whose directory listing leaves the hidden files out; the
// tsconfig is read where it lies, so `extends`, `${configDir}`, the type roots and every relative option resolve exactly as under the bin.
// argv: <typescript module> <JSON file of the absolute paths to hide> <tsc arguments...>
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type * as TypeScript from 'typescript';

const comparable = (file: string): string => {
  const resolved = path.resolve(file).split(path.sep).join('/');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

const [typescript, hiddenFile, ...args] = process.argv.slice(2);
if (typescript === undefined || hiddenFile === undefined) {
  process.stderr.write('tsc-launch: usage: tsc-launch <typescript module> <hidden.json> <tsc arguments...>\n');
  process.exit(2);
}
const ts = createRequire(import.meta.url)(typescript) as typeof TypeScript & { executeCommandLine(system: TypeScript.System, cb: (program: unknown) => void, args: readonly string[]): void };
const hidden = new Set((JSON.parse(fs.readFileSync(hiddenFile, 'utf8')) as string[]).map(comparable));
const system: TypeScript.System = {
  ...ts.sys,
  args,
  readDirectory: (...input) => ts.sys.readDirectory(...input).filter((file) => !hidden.has(comparable(file))),
};
ts.executeCommandLine(system, () => undefined, args);
