import fs from 'node:fs';
import path from 'node:path';
import { codemodMain as buttonIntentMain } from './button-intent.mjs';
import { migratePageNavigation, pageNavigationMarkdown } from './page-navigation.mjs';
import { migrateSectionFrame, sectionFrameMarkdown } from './section-frame.mjs';
import { migrateSmallRenames, smallRenamesMarkdown } from './small-renames.mjs';
import { migrateSpacingRoles, spacingRolesMarkdown } from './spacing-roles.mjs';
import { migrateSurfaceCardKinds, surfaceCardKindsMarkdown } from './surface-card-kinds.mjs';
import { migrateThemeTokens, themeTokensMarkdown } from './theme-tokens.mjs';
import { migrateTierBinding, tierBindingMarkdown } from './tier-binding.mjs';

/** The codemods `starci app codemod` runs, by name. */
export const CODEMODS = Object.freeze(['button-intent', 'spacing-roles', 'theme-tokens', 'small-renames', 'page-navigation', 'section-frame', 'surface-card-kinds', 'tier-binding']);

/** The arguments of `starci app codemod spacing-roles`, `theme-tokens`, `small-renames`, `page-navigation`, `section-frame` and `surface-card-kinds`: --execute, --json, --format and --out; any other is refused. */
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
function runCodemod(name: 'spacing-roles' | 'theme-tokens' | 'small-renames' | 'page-navigation' | 'section-frame' | 'surface-card-kinds' | 'tier-binding', root: string, write: boolean): { report: { findings: readonly unknown[] }; markdown: string } {
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
  if (name === 'small-renames') {
    const report = migrateSmallRenames({ root, write });
    return { report, markdown: smallRenamesMarkdown(report) };
  }
  const report = migrateSpacingRoles({ root, write });
  return { report, markdown: spacingRolesMarkdown(report) };
}

/**
 * CLI boundary of `starci app codemod <name>`. Dry run by default; --execute writes only the safe rewrites. A codemod
 * that leaves a case for a person exits 1 with the complete report.
 */
export function codemodMain(argv: string[], io: { cwd: string; stdout: (text: string) => unknown }): number {
  const [name, ...rest] = argv;
  if (name === 'button-intent') return buttonIntentMain(argv, io);
  if (name !== 'spacing-roles' && name !== 'theme-tokens' && name !== 'small-renames' && name !== 'page-navigation' && name !== 'section-frame' && name !== 'surface-card-kinds' && name !== 'tier-binding') throw new Error(`starci app codemod takes ${CODEMODS.join(' or ')}`);
  const options = spacingRolesArguments(rest);
  if (options.out && !/\.(?:json|md)$/i.test(options.out)) throw new Error('--out needs a .json or .md report file');
  const root = path.resolve(io.cwd);
  const { report, markdown } = runCodemod(name, root, options.write);
  const output = options.format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : markdown;
  if (options.out) {
    const target = path.resolve(io.cwd, options.out);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, output);
  }
  io.stdout(output);
  return report.findings.length ? 1 : 0;
}
