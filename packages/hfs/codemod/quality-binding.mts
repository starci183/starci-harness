import { bindToolingMembers } from '../runtime/scripts/hfs/secret-standard.mjs';

/** One tooling member the migration bound to its service. */
export interface QualityBindingChange { environment: string; member: string; service: string; keys: string[] }
/** One case left for a person: a binding the edit cannot place, or a runtime entry to delete. */
export interface QualityBindingFinding { environment: string; member: string; code: string; reason: string }
/** The report of a migration (`starci app codemod quality-binding`). */
export interface QualityBindingReport { schema: string; root: string; write: boolean; changes: QualityBindingChange[]; findings: QualityBindingFinding[] }

/**
 * Bind the sealed tooling members of an app scaffolded before the binding was rendered (sonar.enc.yaml with `services.sonar.credentials: []`) to their
 * service: the credential and the `ci.secrets` entry the template shows. A runtime `environments.<env>.secrets` entry an earlier `starci app secret set`
 * declared for such a member is named for the owner to delete, since CI custody refuses a CI secret granted at runtime (APP_SECRET_IN_CI).
 */
export function migrateQualityBinding({ root, write = false }: { root: string; write?: boolean }): QualityBindingReport {
  const report: QualityBindingReport = { schema: 'starci/quality-binding-report@1', root, write, changes: [], findings: [] };
  for (const item of bindToolingMembers(root, write)) {
    if (item.outcome.bound.length > 0) report.changes.push({ environment: item.environment, member: item.member, service: item.service, keys: item.outcome.bound });
    else if (!write && item.outcome.remedy !== '') report.changes.push({ environment: item.environment, member: item.member, service: item.service, keys: [] });
    else if (item.outcome.remedy !== '') report.findings.push({ environment: item.environment, member: item.member, code: 'QUALITY_BINDING_BY_HAND', reason: item.outcome.remedy });
    if (item.runtimeEntries.length > 0) report.findings.push({ environment: item.environment, member: item.member, code: 'QUALITY_RUNTIME_ENTRY', reason: `environments.${item.environment}.secrets declares ${item.runtimeEntries.join(', ')} for the tooling member ${item.member}; delete the entry, the token is read by CI through services.${item.service}.credentials` });
  }
  return report;
}

const cell = (value: unknown): string => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');

/** Render the binding and what is left for a person as Markdown; JSON consumers read the same report object. */
export function qualityBindingMarkdown(report: QualityBindingReport): string {
  const out = ['# quality-binding', '', `${report.changes.length} tooling member(s) ${report.write ? 'bound' : 'would be bound'}, ${report.findings.length} left for a person.`, ''];
  if (report.findings.length) {
    out.push('## Left for a person', '', '| environment | member | code | reason |', '|---|---|---|---|');
    for (const finding of report.findings) out.push(`| ${finding.environment} | ${finding.member} | ${finding.code} | ${cell(finding.reason)} |`);
    out.push('');
  }
  if (report.changes.length) {
    out.push('## Bound', '', '| environment | member | service |', '|---|---|---|');
    for (const item of report.changes) out.push(`| ${item.environment} | ${item.member} | ${item.service} |`);
    out.push('');
  }
  return `${out.join('\n')}\n`;
}
