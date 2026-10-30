import fs from 'node:fs';
import path from 'node:path';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { isValidCiDeclaration, readCiDeclaration, sealedKeyNames } from '../runtime/scripts/hfs/ci-declaration.mjs';
import { github, refuse } from './github.mjs';
import type { CiOptions, CodedError, Gh, GhSpawn, StdinSource } from './github.mjs';
import { setSecret } from './secret.mjs';
import { setVariable, syncVariables } from './vars.mjs';
import { badgeVisibilityNotices, verifyCi } from './verify.mjs';

/** The commands of `starci app ci` (besides `local`) with the options each takes; the parser refuses every other. */
export const COMMANDS: Record<string, string[]> = {
  'secret set': ['env', 'dependabot', 'repo'],
  'var set': ['env', 'value', 'repo'],
  'var sync': ['execute', 'repo'],
  verify: ['json', 'repo'],
};
export const BOOLEAN = new Set(['dependabot', 'execute', 'json']);

/** Invalid options never echo argv, because an extra argument may itself contain a secret. */
function parse(argv: readonly string[]): { command: string; options: CiOptions; name: string } {
  const command = argv[0] === 'verify' ? 'verify' : argv.slice(0, 2).join(' ');
  const allowed = COMMANDS[command];
  if (!allowed) throw refuse('CI_USAGE', 'use secret set, var set, var sync or verify');
  const positional: string[] = [], options: Record<string, string | boolean> = {};
  for (let i = command === 'verify' ? 1 : 2; i < argv.length; i += 1) {
    const arg = argv[i] as string, match = /^--([^=]+)(?:=(.*))?$/s.exec(arg);
    if (!match && !arg.startsWith('-')) { positional.push(arg); continue; }
    const key = match?.[1] as string;
    if (!allowed.includes(key) || Object.hasOwn(options, key)) throw refuse(command === 'secret set' ? 'CI_VALUE_ARGV' : 'CI_USAGE', 'unsupported or repeated option');
    if (BOOLEAN.has(key)) {
      if ((match as RegExpExecArray)[2] !== undefined) throw refuse('CI_USAGE', 'boolean flags take no value');
      options[key] = true;
    } else {
      const value = (match as RegExpExecArray)[2] ?? argv[++i];
      if (value === undefined || value.startsWith('--') || (key !== 'value' && !value.length)) throw refuse('CI_USAGE', 'an option value is required');
      options[key] = value;
    }
  }
  const named = command.endsWith(' set');
  if (positional.length !== (named ? 1 : 0)) throw refuse(command === 'secret set' && positional.length > 1 ? 'CI_VALUE_ARGV' : 'CI_USAGE', 'provide the declared name only for set');
  if (named && (!/^[A-Z][A-Z0-9_]*$/.test(positional[0] as string) || (positional[0] as string).startsWith('GITHUB_'))) throw refuse('CI_NAME_UNDECLARED', 'a declared uppercase CI name is required');
  if (options.dependabot && options.env) throw refuse('CI_SCOPE_MISMATCH', 'Dependabot secrets have repository scope');
  return { command, options: options as CiOptions, name: positional[0] as string };
}

/** Manifest and sealed key reads remain offline; only github.mjs may invoke the GitHub CLI. */
export async function ciMain(argv: string[], { cwd = process.cwd(), stdout = (s: string): unknown => process.stdout.write(s), stderr = (s: string): unknown => process.stderr.write(s), stdin, env = process.env, tools = {} }: {
  cwd?: string | undefined; stdout?: ((text: string) => unknown) | undefined; stderr?: ((text: string) => unknown) | undefined; stdin?: StdinSource; env?: NodeJS.ProcessEnv | undefined; tools?: { spawn?: GhSpawn | undefined } | undefined;
} = {}): Promise<number> {
  // `ci local` runs the rendered CI on this machine (local.mjs): no manifest custody and no GitHub.
  if (argv[0] === 'local') return (await import('./local.mjs')).ciLocalMain(argv.slice(1), { cwd, stdout, stderr, env });
  try {
    const parsed = parse(argv);
    let doc: any, declaration: ReturnType<typeof readCiDeclaration>, sealed: { key: string }[]; // reason: doc is the YAML-parsed stack declaration
    try {
      doc = parseYaml(fs.readFileSync(path.join(cwd, '.starcistacks/application-stacks.yaml'), 'utf8'));
      declaration = readCiDeclaration(doc);
      sealed = sealedKeyNames(cwd, { fs });
    } catch { throw refuse('CI_DECLARATION_INVALID', 'the manifest or sealed key names could not be read'); }
    if (!isValidCiDeclaration(declaration)) throw refuse('CI_DECLARATION_INVALID', 'correct the CI declaration before using GitHub');
    const gh: Gh = github({ cwd, env, spawn: tools.spawn });
    const context = { ...parsed, declaration, sealed, gh, stdin, stdout };
    if (parsed.command === 'secret set') return await setSecret(context);
    if (parsed.command === 'var set') return await setVariable(context);
    if (parsed.command === 'var sync') return syncVariables(context);
    const notices = badgeVisibilityNotices({ doc, gh: context.gh, repo: context.gh.repository(parsed.options.repo) });
    return verifyCi({ ...context, notices });
  } catch (error) {
    stderr(`${(error as Partial<CodedError>).code ? (error as Error).message : 'CI_USAGE: CI command could not complete'}\n`);
    return 2;
  }
}
