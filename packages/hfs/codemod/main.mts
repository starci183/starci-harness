import fs from 'node:fs';
import path from 'node:path';
import { migratePageNavigation, pageNavigationMarkdown } from './page-navigation.mjs';
import { migrateSmallRenames, smallRenamesMarkdown } from './small-renames.mjs';
import { migrateSpacingRoles, spacingRolesMarkdown } from './spacing-roles.mjs';
import { explicitSurfaceMarkdown, migrateExplicitSurface } from './explicit-surface.mjs';
import { commonBaseMarkdown, migrateCommonBase } from './common-base.mjs';
import { migrateModuleDefinition, moduleDefinitionMarkdown } from './module-definition.mjs';
import { migrateSeedsLayout, seedsLayoutMarkdown } from './seeds-layout.mjs';
import { GRAMMAR_CODEMOD_ID, installedGrammar, listMarkdown, loadGrammarCodemods, rangeArguments, runGrammarCodemods } from './grammar.mjs';

/** The codemods `starci app codemod` runs, by name. */
export const CODEMODS = Object.freeze(['spacing-roles', 'small-renames', 'page-navigation', 'explicit-surface', 'module-definition', 'seeds-layout', 'common-base']);

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
function runCodemod(name: Exclude<(typeof CODEMODS)[number], 'explicit-surface' | 'module-definition'>, root: string, write: boolean): { report: { findings: readonly unknown[] }; markdown: string } {
  if (name === 'common-base') {
    const report = migrateCommonBase({ root, write });
    return { report, markdown: commonBaseMarkdown(report) };
  }
  if (name === 'seeds-layout') {
    const report = migrateSeedsLayout({ root, write });
    return { report, markdown: seedsLayoutMarkdown(report) };
  }
  if (name === 'page-navigation') {
    const report = migratePageNavigation({ root, write });
    return { report, markdown: pageNavigationMarkdown(report) };
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

/**
 * CLI boundary of `starci app codemod <name>`. Dry run by default; --execute writes only the safe rewrites. A codemod
 * that leaves a case for a person exits 1 with the complete report.
 */
export function codemodMain(argv: string[], io: Io): number | Promise<number> {
  const [name, ...rest] = argv;
  if (name === '--list') return grammarListMain(rest, io);
  if (name !== undefined && (GRAMMAR_CODEMOD_ID.test(name) || name === '--from' || name.startsWith('--from=') || name === '--to' || name.startsWith('--to='))) return grammarCodemodMain(argv, io);
  if (name === 'explicit-surface') return explicitSurfaceMain(rest, io);
  if (name === 'module-definition') return moduleDefinitionMain(rest, io);
  if (name === undefined || !CODEMODS.includes(name)) throw new Error(`starci app codemod takes a Grammar codemod (v<major><minor><patch>, starci app codemod --list), --from <installed> [--to <target>], or ${CODEMODS.join(' or ')}`);
  const options = reportArguments(rest);
  return emit(options, runCodemod(name as Parameters<typeof runCodemod>[0], path.resolve(io.cwd), options.write), io);
}

/** `starci app codemod --list [--json]`: every codemod of the installed Grammar, with its version and summary. */
async function grammarListMain(argv: readonly string[], io: Io): Promise<number> {
  const options = reportArguments(argv);
  const root = path.resolve(io.cwd);
  const grammar = installedGrammar(root);
  if (!grammar) throw new Error(`no @starci/grammar is installed under ${root}: install the app's dependencies first`);
  const { CODEMODS: codemods } = await loadGrammarCodemods(grammar);
  const report = { grammar: grammar.version, codemods: codemods.map(({ id, version, summary }) => ({ id, version, summary })), findings: [] };
  return emit(options, { report, markdown: listMarkdown(codemods, grammar) }, io);
}

/**
 * `starci app codemod v0540 [--execute]` or `starci app codemod --from <installed> [--to <target>] [--execute]`: the Grammar's codemods
 * (codemod/grammar.mts), from the Grammar the app installed, in version order. Dry until --execute; exit 1 when a case is left for a person.
 */
async function grammarCodemodMain(argv: readonly string[], io: Io): Promise<number> {
  const id = argv[0] !== undefined && GRAMMAR_CODEMOD_ID.test(argv[0]) ? argv[0] : undefined;
  const range = rangeArguments(id === undefined ? argv : argv.slice(1));
  if (id !== undefined && (range.from !== undefined || range.to !== undefined)) throw new Error('name one codemod, or a --from/--to range, not both');
  const options = reportArguments(range.rest);
  const { grammar, reports } = await runGrammarCodemods({ root: path.resolve(io.cwd), write: options.write, ...(id === undefined ? {} : { id }), ...(range.from === undefined ? {} : { from: range.from }), ...(range.to === undefined ? {} : { to: range.to }) });
  const findings = reports.flatMap(({ report }) => report.findings);
  const markdown = reports.length
    ? reports.map(({ codemod, report }) => codemod.markdown(report)).join('\n')
    : `# starci app codemod: no Grammar codemod between ${range.from ?? '?'} and ${range.to ?? grammar.version}\n\nNo app-facing change of the Grammar in that range needs one.\n`;
  const report = { grammar: grammar.version, reports: reports.map(({ report: each }) => each), findings };
  return emit(options, { report, markdown }, io);
}
