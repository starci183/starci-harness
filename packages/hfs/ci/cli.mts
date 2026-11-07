import fs from 'node:fs';
import path from 'node:path';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { isValidCiDeclaration, readCiDeclaration, sealedKeyNames, serviceBindings, serviceCredentialNames, runtimeGranted } from '../runtime/scripts/hfs/ci-declaration.mjs';
import { repositoryName, identityQueryEnvironment } from '../runtime/scripts/hfs/repo-identity.mjs';
import { serviceCredentialFile, serviceCredentialValue } from '../runtime/scripts/hfs/secret-store.mjs';
import { defaultSops, type SecretSops } from '../runtime/scripts/hfs/secret-sops.mjs';
import type { AgeHost } from '../runtime/scripts/hfs/secret-init.mjs';
import { github, refuse } from './github.mjs';
import type { CiOptions, CodedError, Gh, GhSpawn, StdinSource } from './github.mjs';
import { setSecret } from './secret.mjs';
import { setVariable, syncVariables } from './vars.mjs';
import { badgeVisibilityNotices, verifyCi } from './verify.mjs';

/** The commands of `starci app ci` (besides `local`) with the options each takes; the parser refuses every other. */
export const COMMANDS: Record<string, string[]> = {
  'secret set': ['env', 'dependabot', 'repo', 'execute', 'from-custody'],
  'var set': ['env', 'value', 'repo', 'execute'],
  'var sync': ['execute', 'repo'],
  verify: ['json', 'repo'],
};
export const BOOLEAN = new Set(['dependabot', 'execute', 'json', 'from-custody']);

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

/** Manifest and sealed key reads remain offline; only github.mts may invoke the GitHub CLI. */
export async function ciMain(argv: string[], { cwd = process.cwd(), stdout = (s: string): unknown => process.stdout.write(s), stderr = (s: string): unknown => process.stderr.write(s), stdin, env = process.env, tools = {}, hostIdentity, sops, platform = process.platform, inputRedirected }: {
  cwd?: string | undefined; stdout?: ((text: string) => unknown) | undefined; stderr?: ((text: string) => unknown) | undefined; stdin?: StdinSource; env?: NodeJS.ProcessEnv | undefined; tools?: { spawn?: GhSpawn | undefined } | undefined;
  hostIdentity?: AgeHost | null | undefined; sops?: Pick<SecretSops, 'decrypt'> | null | undefined; platform?: NodeJS.Platform | undefined;
  inputRedirected?: (() => boolean) | undefined;
} = {}): Promise<number> {
  // `ci local` runs the rendered CI on this machine (local.mts): no manifest custody and no GitHub.
  if (argv[0] === 'local') return (await import('./local.mjs')).ciLocalMain(argv.slice(1), { cwd, stdout, stderr, env });
  try {
    const parsed = parse(argv);
    let doc: any, declaration: ReturnType<typeof readCiDeclaration>, sealed: ReturnType<typeof sealedKeyNames>; // reason: doc is the YAML-parsed stack declaration
    try {
      doc = parseYaml(fs.readFileSync(path.join(cwd, '.starcistacks/application-stacks.yaml'), 'utf8'));
      declaration = readCiDeclaration(doc);
      sealed = sealedKeyNames(cwd, { fs });
    } catch { throw refuse('CI_DECLARATION_INVALID', 'the manifest or sealed key names could not be read'); }
    if (!isValidCiDeclaration(declaration)) throw refuse('CI_DECLARATION_INVALID', 'correct the CI declaration before using GitHub');
    const childEnv = identityQueryEnvironment(env, serviceCredentialNames(doc));
    const repository = repositoryName(cwd, { env: childEnv }), selected = serviceBindings(doc, repository);
    if (selected.problems.length) throw refuse('CI_CUSTODY_INVALID', 'correct the explicit project service credential bindings before using CI');
    const runtime = sealed.filter((entry) => runtimeGranted(doc, entry.env, entry.member, entry.key));
    if (parsed.command.endsWith(' set') && runtime.some((entry) => entry.key === parsed.name))
      throw refuse('APP_SECRET_IN_CI', 'the selected key belongs to app runtime authority');
    if (parsed.options['from-custody']) {
      const binding = selected.bindings.find((item) => item.name === parsed.name);
      if (!binding || parsed.options.dependabot) throw refuse('CI_CUSTODY_INVALID', 'one project service binding is required');
      try { serviceCredentialFile(cwd, binding); } catch { throw refuse('CI_CUSTODY_INVALID', 'the selected project member is missing, ambiguous or outside this product'); }
      if (parsed.options.repo && (parsed.options.repo.split('/')[1] !== repository || (doc.ci?.github?.repository && parsed.options.repo !== doc.ci.github.repository)))
        throw refuse('CI_CUSTODY_INVALID', 'the destination repository differs from this project');
    }
    const gh: Gh = github({ cwd, env: childEnv, spawn: tools.spawn });
    const custody = (binding: (typeof selected.bindings)[number]): string => {
      try { return serviceCredentialValue(cwd, binding, sops ?? defaultSops(env, cwd, platform, undefined, hostIdentity)); }
      catch { throw refuse('CI_CUSTODY_UNAVAILABLE', 'the selected service member could not be opened with the owner identity'); }
    };
    const context = { ...parsed, declaration, sealed, runtime, gh, stdin, stdout, bindings: selected.bindings, custody, inputRedirected };
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
