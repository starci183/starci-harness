// codegen.mts - the app's code generation that type programs read (contexts/project/check-cache.md, "Which step reuses what", the `types` step). The convention is the one
// every app command already uses (`npm run codegen`, as the dev and build scripts and the CI build steps run it): a root `package.json` script named `codegen`. Its outputs are
// untracked (a gitignored `__generated__` folder), so a fresh tree has none and tsc would report every import of them. The types step runs it before the first program, skipping
// it while its stamp (the tracked files it can read: `package.json`, the lockfile, `*.graphql`/`*.gql`, anything under a folder named `graphql`, `contracts`, `scripts`
// or `codegen`, and any `codegen*` file) is unchanged and every output it produced is present. The stamp is host state in the untracked tool cache. A program's key holds the
// hash of each generated file under its folder (generatedInputs), so a change in the inputs that changes the output re-keys the programs that read it.
import fs from 'node:fs';
import path from 'node:path';
import { combineHashes } from './hash.mjs';
import { git } from './git.mjs';
import { shellArgv, type ParityRun } from './parity-family.mjs';
import type { CheckSession } from './types.mjs';

/** The failure code of a code generation that fails. */
export const TYPES_CODEGEN_FAILED = 'TYPES_CODEGEN_FAILED';

const INPUT = /(?:^|\/)(?:package(?:-lock)?\.json|codegen[^/]*|[^/]*\.(?:graphql|gql))$|(?:^|\/)(?:graphql|contracts|scripts|codegen)\//u;
/** Where generated code lands: a gitignored folder named `__generated__` (the convention of the GraphQL and OpenAPI generators). */
const GENERATED = ':(glob)**/__generated__/**';

/** The root script `codegen` of the app, if it declares one. */
export function codegenScript(root: string): string | undefined {
  try {
    const scripts = (JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, unknown> }).scripts;
    return typeof scripts?.['codegen'] === 'string' ? scripts['codegen'] : undefined;
  } catch {
    return undefined;
  }
}

/** The untracked generated files of the work tree, app-relative posix, sorted. */
export function generatedFiles(root: string): string[] {
  const out = git(root, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--', GENERATED]).stdout;
  return out.split('\0').filter((file) => file !== '' && !file.includes('node_modules/')).sort();
}

/** The generated files a program reads, as untracked inputs of its key (hashed by content): those under `prefix`. */
export function generatedInputs(root: string, prefix: string): string[] {
  return generatedFiles(root).filter((file) => file.startsWith(prefix));
}

const stampFile = (toolCacheDir: string): string => path.join(path.resolve(toolCacheDir), 'codegen', 'stamp.json');

function inputKey(session: CheckSession): string {
  const parts: Record<string, string> = {};
  for (const file of session.index.paths) if (INPUT.test(file) && !file.startsWith('.starcistacks/')) parts[file] = session.index.hashOf(file) ?? 'absent';
  return combineHashes(parts);
}

export interface CodegenResult {
  readonly state: 'none' | 'ran' | 'skipped' | 'failed';
  /** The last lines the failed generation printed. */
  readonly message?: string;
}

const tailOf = (text: string): string => text.split('\n').map((line) => line.trim()).filter(Boolean).slice(-5).join(' | ').slice(0, 600);

/** Runs `npm run codegen` from the app root through the governor's command port unless its stamp is unchanged and its outputs are all present. */
export async function runCodegen(options: { readonly session: CheckSession; readonly repoRoot: string; readonly toolCacheDir: string; readonly env: NodeJS.ProcessEnv; readonly run: ParityRun }): Promise<CodegenResult> {
  const { session, repoRoot, toolCacheDir, env, run } = options;
  if (codegenScript(repoRoot) === undefined) return { state: 'none' };
  const key = inputKey(session);
  const stamp = stampFile(toolCacheDir);
  let held: { key?: unknown; outputs?: unknown } = {};
  try { held = JSON.parse(fs.readFileSync(stamp, 'utf8')) as typeof held; } catch { /* no stamp */ }
  const outputs = Array.isArray(held.outputs) ? held.outputs.filter((file): file is string => typeof file === 'string') : [];
  if (held.key === key && outputs.every((file) => fs.existsSync(path.join(repoRoot, file)))) return { state: 'skipped' };
  const result = await run({ kind: 'build', label: 'app check types codegen', cwd: repoRoot, argv: shellArgv('npm run codegen --silent', process.platform, env), env });
  if (result.status !== 0 || result.error !== undefined) return { state: 'failed', message: `\`npm run codegen\` failed (exit ${String(result.status)}): ${result.error?.message ?? tailOf(`${result.stdout}\n${result.stderr}`)}` };
  fs.mkdirSync(path.dirname(stamp), { recursive: true });
  fs.writeFileSync(stamp, `${JSON.stringify({ key, outputs: generatedFiles(repoRoot) })}\n`);
  return { state: 'ran' };
}
