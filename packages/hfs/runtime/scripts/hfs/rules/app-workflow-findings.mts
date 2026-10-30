// app-workflow-findings.mjs - app-root workflow scope shared by deployment and expression-context rules.
import { workflowFindings } from '../runtime-rules/workflow-source.mjs';
import { readText } from './read.mjs';
import type { Parsed, Repo } from './rule-types.mjs';

/** Judge tracked workflows only at full/lite app roots, preserving each caller's duplicate-file policy. */
export function appWorkflowFindings({ repoRoot, files, all = files, repo, isRoot, inScope = () => true }: { repoRoot: string; files: string[]; all?: string[]; repo: Repo; isRoot: boolean; inScope?: (file: string) => boolean }, perWorkflow: Parsed, { dedupe = false } = {}) {
  if (isRoot === false || repo?.kind !== 'app' || !['lite', 'full'].some((edition) => edition === repo.edition)) return [];
  const selected = dedupe ? [...new Set(all)] : all;
  return workflowFindings({ files: selected.filter((file: string) => inScope(file)), read: (file: string) => readText(repoRoot, file) }, perWorkflow);
}
