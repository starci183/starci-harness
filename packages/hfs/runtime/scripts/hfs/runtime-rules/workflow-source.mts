// workflow-source.mjs - what the workflow rules (ci-upload.mjs, git-triggers.mjs) share: which tracked files are CI workflows, and a workflow's
// YAML document. A template's `{{placeholder}}` lines are blanked before the text is parsed.
import { parseYaml } from '../../../engine/yaml.mjs';
import type { Parsed } from '../rules/rule-types.mjs';

const WORKFLOW = /(?:^|\/)\.?(?:github\/)?workflows\/[^/]+\.ya?ml$/;

/** The tracked workflow files of the runtime, its examples and the hfs templates. */
const workflowFiles = (files: string[]) => files.filter((file: string) => WORKFLOW.test(file));

/** The parsed workflow, or null when the text is not YAML (the other checks name that). */
export function parseWorkflow(text: string) {
  try { return parseYaml(text.replace(/^\{\{\w+\}\}\s*$/gm, '').replace(/\{\{\w+\}\}/g, 'x')); } catch { return null; }
}

/** The findings of `perFile({path, text})` over every tracked workflow `ctx` holds (ctx of scripts/hfs/runtime-check.mjs). */
export const workflowFindings = (ctx: Parsed, perFile: Parsed) => workflowFiles(ctx.files).flatMap((file: string) => {
  const text = ctx.read(file);
  return text === null || text === undefined ? [] : perFile({ path: file, text });
});
