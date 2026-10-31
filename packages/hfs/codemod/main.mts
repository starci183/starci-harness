import fs from 'node:fs';
import path from 'node:path';
import { codemodMain as buttonIntentMain } from './button-intent.mjs';
import { migrateSpacingRoles, spacingRolesMarkdown } from './spacing-roles.mjs';

/** The codemods `starci app codemod` runs, by name. */
export const CODEMODS = Object.freeze(['button-intent', 'spacing-roles']);

/** The arguments of `starci app codemod spacing-roles`: --execute, --json, --format and --out; any other is refused. */
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

/**
 * CLI boundary of `starci app codemod <name>`. Dry run by default; --execute writes only the safe rewrites. A codemod
 * that leaves a case for a person exits 1 with the complete report.
 */
export function codemodMain(argv: string[], io: { cwd: string; stdout: (text: string) => unknown }): number {
  const [name, ...rest] = argv;
  if (name === 'button-intent') return buttonIntentMain(argv, io);
  if (name !== 'spacing-roles') throw new Error(`starci app codemod takes ${CODEMODS.join(' or ')}`);
  const options = spacingRolesArguments(rest);
  if (options.out && !/\.(?:json|md)$/i.test(options.out)) throw new Error('--out needs a .json or .md report file');
  const report = migrateSpacingRoles({ root: path.resolve(io.cwd), write: options.write });
  const output = options.format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : spacingRolesMarkdown(report);
  if (options.out) {
    const target = path.resolve(io.cwd, options.out);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, output);
  }
  io.stdout(output);
  return report.findings.length ? 1 : 0;
}
