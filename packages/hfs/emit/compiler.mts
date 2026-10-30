/**
 * The compiler options both emit workers use: the repository's own tsconfig.json, made emit-safe, with the two decorator switches
 * Nest needs. A configuration that cannot be read completely (an `extends` package that is not installed here) falls back to what
 * a Nest project compiles with, and each problem is handed to `note` so the caller can report it like a stand-in.
 */
import path from 'node:path';
import type TypeScript from 'typescript';

/** Answers the compiler options of the repository at `repoRoot`. */
export function compilerOptionsOf(ts: typeof TypeScript, repoRoot: string, note: (message: string) => unknown = () => {}): TypeScript.CompilerOptions {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    path.join(repoRoot, 'tsconfig.json'),
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (diagnostic: TypeScript.Diagnostic) => { throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')); } },
  )!; // an unreadable configuration never returns: the host callback above throws first
  for (const error of parsed.errors) note(`tsconfig.json (${ts.flattenDiagnosticMessageText(error.messageText, ' ')}): compiler options fall back to the Nest defaults`);
  const options: TypeScript.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
    ...parsed.options,
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
    declaration: false,
    declarationMap: false,
    sourceMap: false,
    inlineSourceMap: false,
    incremental: false,
    composite: false,
    noEmit: false,
    noEmitOnError: false,
  };
  // The repository configuration may set these three; the emit workers never write build info or redirect the output.
  delete options.tsBuildInfoFile;
  delete options.outDir;
  delete options.rootDir;
  return options;
}
