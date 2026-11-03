import fs from 'node:fs';
import path from 'node:path';
import { accountDoorsMarkdown, migrateAccountDoors } from './account-doors.mjs';
import { codemodMain as buttonIntentMain } from './button-intent.mjs';
import { migratePageNavigation, pageNavigationMarkdown } from './page-navigation.mjs';
import { loadingStatesMarkdown, migrateLoadingStates } from './loading-states.mjs';
import { migrateSectionFrame, sectionFrameMarkdown } from './section-frame.mjs';
import { migrateSmallRenames, smallRenamesMarkdown } from './small-renames.mjs';
import { migrateSpacingRoles, spacingRolesMarkdown } from './spacing-roles.mjs';
import { migrateSurfaceCardKinds, surfaceCardKindsMarkdown } from './surface-card-kinds.mjs';
import { explicitSurfaceMarkdown, migrateExplicitSurface } from './explicit-surface.mjs';
import { directiveFirstMarkdown, migrateDirectiveFirst } from './directive-first.mjs';
import { migrateModuleDefinition, moduleDefinitionMarkdown } from './module-definition.mjs';
import { migrateQualityBinding, qualityBindingMarkdown } from './quality-binding.mjs';
import { migrateSopsRules, sopsRulesMarkdown } from './sops-rules.mjs';
import { migrateSecretsCache, secretsCacheMarkdown } from './secrets-cache.mjs';
import { migrateSeedsLayout, seedsLayoutMarkdown } from './seeds-layout.mjs';
import { migrateThemeTokens, themeTokensMarkdown } from './theme-tokens.mjs';
import { migrateTierBinding, tierBindingMarkdown } from './tier-binding.mjs';

/** The codemods `starci app codemod` runs, by name. */
export const CODEMODS = Object.freeze(['button-intent', 'spacing-roles', 'theme-tokens', 'small-renames', 'page-navigation', 'section-frame', 'surface-card-kinds', 'tier-binding', 'loading-states', 'explicit-surface', 'directive-first', 'secrets-cache', 'module-definition', 'sops-rules', 'quality-binding', 'account-doors', 'seeds-layout']);

/** The arguments of every report-style `starci app codemod`: --execute, --json, --format and --out; any other is refused. */
export function spacingRolesArguments(argv: readonly string[]): { write: boolean; format: 'json' | 'markdown'; out?: string } {
  const options: { write: boolean; format: 'json' | 'markdown'; out?: string } = { write: false, format: 'markdown' };
  const args = argv.values();
  for (const arg of args) {
    const [flag, inline] = arg.split(/=(.*)/s);
    if (flag === '--execute' || flag === '--json') {
      if (inline !== undefined && !['true', 'false'].includes(inline)) throw new Error(`${flag} expects true or false`);
      const value = inline === undefined || inline === 'true';
      if (flag === '--execute') options.write = value;
      else if (value) options.format = 'json';
    } else if (flag === '--format' || flag === '--out') {
      const value = inline ?? args.next().value;
      if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`);
      if (flag === '--out') options.out = value;
      else if (value === 'json' || value === 'markdown') options.format = value;
      else throw new Error('--format accepts json or markdown');
    } else throw new Error(`unknown codemod option ${arg}`);
  }
  return options;
}

/** One of the report-style codemods run at an app root: its report object and the Markdown of it. */
function runCodemod(name: Exclude<(typeof CODEMODS)[number], 'button-intent' | 'explicit-surface' | 'account-doors' | 'module-definition'>, root: string, write: boolean): { report: { findings: readonly unknown[] }; markdown: string } {
  if (name === 'seeds-layout') {
    const report = migrateSeedsLayout({ root, write });
    return { report, markdown: seedsLayoutMarkdown(report) };
  }
  if (name === 'quality-binding') {
    const report = migrateQualityBinding({ root, write });
    return { report, markdown: qualityBindingMarkdown(report) };
  }
  if (name === 'sops-rules') {
    const report = migrateSopsRules({ root, write });
    return { report, markdown: sopsRulesMarkdown(report) };
  }
  if (name === 'secrets-cache') {
    const report = migrateSecretsCache({ root, write });
    return { report, markdown: secretsCacheMarkdown(report) };
  }
  if (name === 'directive-first') {
    const report = migrateDirectiveFirst({ root, write });
    return { report, markdown: directiveFirstMarkdown(report) };
  }
  if (name === 'theme-tokens') {
    const report = migrateThemeTokens({ root, write });
    return { report, markdown: themeTokensMarkdown(report) };
  }
  if (name === 'surface-card-kinds') {
    const report = migrateSurfaceCardKinds({ root, write });
    return { report, markdown: surfaceCardKindsMarkdown(report) };
  }
  if (name === 'tier-binding') {
    const report = migrateTierBinding({ root, write });
    return { report, markdown: tierBindingMarkdown(report) };
  }
  if (name === 'page-navigation') {
    const report = migratePageNavigation({ root, write });
    return { report, markdown: pageNavigationMarkdown(report) };
  }
  if (name === 'section-frame') {
    const report = migrateSectionFrame({ root, write });
    return { report, markdown: sectionFrameMarkdown(report) };
  }
  if (name === 'loading-states') {
    const report = migrateLoadingStates({ root, write });
    return { report, markdown: loadingStatesMarkdown(report) };
  }
  if (name === 'small-renames') {
    const report = migrateSmallRenames({ root, write });
    return { report, markdown: smallRenamesMarkdown(report) };
  }
  const report = migrateSpacingRoles({ root, write });
  return { report, markdown: spacingRolesMarkdown(report) };
}


type Io = { cwd: string; stdout: (text: string) => unknown };

/** The report written where the options say (`--out`) and to stdout; the exit code is 1 when a case is left for a person. */
function emit(options: ReturnType<typeof spacingRolesArguments>, result: { report: { findings: readonly unknown[] }; markdown: string }, io: Io): number {
  const output = options.format === 'json' ? `${JSON.stringify(result.report, null, 2)}\n` : result.markdown;
  if (options.out) {
    const target = path.resolve(io.cwd, options.out);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, output);
  }
  io.stdout(output);
  return result.report.findings.length ? 1 : 0;
}

/** The arguments of a report-style codemod: spacingRolesArguments, and a report file that is JSON or Markdown. */
function reportArguments(argv: readonly string[]): ReturnType<typeof spacingRolesArguments> {
  const options = spacingRolesArguments(argv);
  if (options.out && !/\.(?:json|md)$/i.test(options.out)) throw new Error('--out needs a .json or .md report file');
  return options;
}

/** `starci app codemod explicit-surface`: it reads the app's types through the compiler and formats with its Prettier, both asynchronous. */
async function explicitSurfaceMain(argv: readonly string[], io: Io): Promise<number> {
  const options = reportArguments(argv);
  const report = await migrateExplicitSurface({ root: path.resolve(io.cwd), write: options.write });
  return emit(options, { report, markdown: explicitSurfaceMarkdown(report) }, io);
}

/** `starci app codemod module-definition`: it formats each rewritten definition with the app's Prettier, which is asynchronous. */
async function moduleDefinitionMain(argv: readonly string[], io: Io): Promise<number> {
  const options = reportArguments(argv);
  const report = await migrateModuleDefinition({ root: path.resolve(io.cwd), write: options.write });
  return emit(options, { report, markdown: moduleDefinitionMarkdown(report) }, io);
}

/** `starci app codemod account-doors [--contract]`: the expand migration of the account doors, or (a release later) the contract migration that revokes the old grants. */
function accountDoorsMain(argv: readonly string[], io: Io): number {
  const contract = argv.includes('--contract');
  const options = reportArguments(argv.filter((arg) => arg !== '--contract'));
  const report = migrateAccountDoors({ root: path.resolve(io.cwd), write: options.write, contract });
  return emit(options, { report, markdown: accountDoorsMarkdown(report) }, io);
}

/**
 * CLI boundary of `starci app codemod <name>`. Dry run by default; --execute writes only the safe rewrites. A codemod
 * that leaves a case for a person exits 1 with the complete report.
 */
export function codemodMain(argv: string[], io: Io): number | Promise<number> {
  const [name, ...rest] = argv;
  if (name === 'button-intent') return buttonIntentMain(argv, io);
  if (name === 'explicit-surface') return explicitSurfaceMain(rest, io);
  if (name === 'account-doors') return accountDoorsMain(rest, io);
  if (name === 'module-definition') return moduleDefinitionMain(rest, io);
  if (name === undefined || !CODEMODS.includes(name)) throw new Error(`starci app codemod takes ${CODEMODS.join(' or ')}`);
  const options = reportArguments(rest);
  return emit(options, runCodemod(name as Parameters<typeof runCodemod>[0], path.resolve(io.cwd), options.write), io);
}
