import fs from 'node:fs';
import path from 'node:path';
import { parseYaml, stringifyYaml } from '../runtime/engine/yaml.mjs';

/** One creation rule the migration rewrites: the rule's index, the path_regex it had and the one it has. */
export interface SopsRuleChange { rule: number; from: string; to: string }
/** One case left for a person. */
export interface SopsRuleFinding { file: string; code: string; reason: string }
/** The report of a migration (`starci app codemod sops-rules`). */
export interface SopsRulesReport { schema: string; root: string; write: boolean; file: string; changes: SopsRuleChange[]; findings: SopsRuleFinding[] }

const FILE = '.sops.yaml';
/** The rule an earlier `secret init` wrote: it matches the legacy `.enc` spelling of a member only. */
const LEGACY = String.raw`\.starcistacks[/\\][^/\\]+[/\\]secrets[/\\][^/\\]+\.enc$`;
/** The rule `secret init` writes now: both spellings of a member (`.enc` and `.enc.yaml`), every environment. */
const CURRENT = String.raw`\.starcistacks[/\\][^/\\]+[/\\]secrets[/\\][^/\\]+\.enc(?:\.yaml)?$`;
/** A per-environment rule written for the legacy spelling alone: `.enc$` where the managed form ends `.enc(?:\.yaml)?$`. */
const LEGACY_END = String.raw`\.enc$`;
const MODERN_END = String.raw`\.enc(?:\.yaml)?$`;

/** The path_regex a managed `.sops.yaml` carries for a rule written with `from`, or `from` when it is already managed or is no member rule. */
export function managedPathRegex(from: string): string {
  if (from === LEGACY) return CURRENT;
  return /secrets/.test(from) && from.endsWith(LEGACY_END) ? `${from.slice(0, -LEGACY_END.length)}${MODERN_END}` : from;
}

/**
 * Migrate a legacy `.sops.yaml` to the form `starci app secret init --env` writes (public recipients only, a rule per member spelling): a rule whose
 * path_regex matches the legacy `.enc` spelling alone also matches `.enc.yaml`, the spelling `secret set` writes, which sops otherwise refuses with
 * no creation rule. Recipients and the other rules are kept; nothing private is read or written.
 */
export function migrateSopsRules({ root, write = false }: { root: string; write?: boolean }): SopsRulesReport {
  const report: SopsRulesReport = { schema: 'starci/sops-rules-report@1', root, write, file: FILE, changes: [], findings: [] };
  const target = path.join(root, FILE);
  if (!fs.existsSync(target)) return report;
  let config: { creation_rules?: Array<{ path_regex?: unknown; [name: string]: unknown }>; [name: string]: unknown } | null;
  try { config = parseYaml(fs.readFileSync(target, 'utf8')) as typeof config; } catch { config = null; }
  if (config === null || typeof config !== 'object' || !Array.isArray(config.creation_rules)) {
    report.findings.push({ file: FILE, code: 'SOPS_RULES_UNREADABLE', reason: `${FILE} holds no creation_rules list; write it with starci app secret init --env <env>` });
    return report;
  }
  config.creation_rules.forEach((rule, index) => {
    if (typeof rule?.path_regex !== 'string') return;
    const to = managedPathRegex(rule.path_regex);
    if (to === rule.path_regex) return;
    report.changes.push({ rule: index, from: rule.path_regex, to });
    rule.path_regex = to;
  });
  if (report.changes.length > 0 && write) fs.writeFileSync(target, stringifyYaml(config));
  return report;
}

const cell = (value: unknown): string => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');

/** Render the migration and what is left for a person as Markdown; JSON consumers read the same report object. */
export function sopsRulesMarkdown(report: SopsRulesReport): string {
  const out = ['# sops-rules', '', `${report.changes.length} creation rule(s) ${report.write ? 'migrated' : 'would be migrated'}, ${report.findings.length} left for a person.`, ''];
  if (report.findings.length) {
    out.push('## Left for a person', '', '| file | code | reason |', '|---|---|---|');
    for (const finding of report.findings) out.push(`| ${cell(finding.file)} | ${finding.code} | ${cell(finding.reason)} |`);
    out.push('');
  }
  if (report.changes.length) {
    out.push('## Migrated', '', '| rule | from | to |', '|---|---|---|');
    for (const item of report.changes) out.push(`| ${item.rule} | \`${cell(item.from)}\` | \`${cell(item.to)}\` |`);
    out.push('');
  }
  return `${out.join('\n')}\n`;
}
