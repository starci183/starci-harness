// The child process of `starci app emit` for the operations of one app.
// Prints the OpenAPI 3.1 document of the app's typed operation table on stdout; exit 3 when the app has no `apps/<app>/src/operations.ts`.
// Loads the repository's own TypeScript and zod. Only *.schema.ts modules are evaluated; the app is never booted.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import type TypeScript from 'typescript';
import { compilerOptionsOf } from './compiler.mjs';
import { openApiText, operationsPath, readOperations } from './operations.mjs';

// The parent (contracts.mts) always passes the repository root and the app.
const [rootArgument, app] = process.argv.slice(2) as [string, string];
const repoRoot = path.resolve(rootArgument);
const file = path.join(repoRoot, operationsPath(app));
if (!fs.existsSync(file)) process.exit(3);
const ts: typeof TypeScript = createRequire(path.join(repoRoot, 'package.json'))('typescript');
const options = compilerOptionsOf(ts, repoRoot, (message: string) => process.stderr.write(`stand-in ${message}\n`));
const program = ts.createProgram({ rootNames: [file], options });
try {
  const { operations, components } = readOperations({ ts, program, file, repoRoot })!; // the file is the program's own root, so it is found
  process.stdout.write(openApiText({ app, operations, components }));
} catch (error) {
  process.stderr.write(`${(error as Error).message}
`);
  process.exit(1);
}
