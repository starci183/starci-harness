/** The TypeScript program a rule resolves symbols through: the lint run's own when typed linting is on, else one rooted at the linted file. */
import ts from "typescript"
import path from "node:path"
import type { AnyContext } from "./rule.ts"

const programs = new WeakMap<AnyContext, ts.Program>()

/** The program for a rule context; a program built here is remembered per context. */
export function programFor(context: AnyContext): ts.Program {
  const remembered = programs.get(context)
  if (remembered !== undefined) return remembered
  const services = context.sourceCode?.parserServices
  if (services?.program) return services.program
  const filename = context.filename
  const configPath = ts.findConfigFile(path.dirname(filename), ts.sys.fileExists)
  let options: ts.CompilerOptions = { moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext }
  if (configPath) {
    const config = ts.readConfigFile(configPath, ts.sys.readFile)
    options = { ...options, ...ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath)).options }
  }
  const program = ts.createProgram([filename], options)
  programs.set(context, program)
  return program
}
