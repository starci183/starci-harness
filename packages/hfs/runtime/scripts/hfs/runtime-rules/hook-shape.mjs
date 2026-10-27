// hook-shape.mjs - RT_HOOK_SHAPE (knowledge/hfs/rules.yaml, gate runtime): the app hook templates keep the gate model.
//   pre-commit  L0 only: no typecheck and no test run (`test:` scripts, npm test, jest, vitest, a spec). Types and the targeted specs
//               belong to the op gate.
//   pre-push    the bundled push gate owns fast-forward main, annotated tags and the secret scan; no build, test or lint run.
// Guard hooks keep their host timeout above the runtime's own input, verdict, cleanup and output budgets.
// Comments are not judged (the templates explain what they do not run). Pure apart from ctx.read.
import { shellCommandSource } from '../../lib/shell-source.mjs';
import { HOOK_INPUT_LIMITS } from '../../lib/hook-limits.mjs';

export const CODE = 'RT_HOOK_SHAPE';
export const TEMPLATE_DIR = 'packages/hfs/templates/app/hooks/husky';
const PRE_COMMIT = `${TEMPLATE_DIR}/pre-commit`;
const PRE_PUSH = `${TEMPLATE_DIR}/pre-push`;
const HOST_SETTINGS = '.claude/settings.json';
const GUARD_LIMITS = 'modules/kernel/hook-input.yaml';

const PRE_COMMIT_FORBIDDEN = [
  [/\btypecheck\b/, 'a typecheck'],
  [/\btest:|\bnpm\s+(?:run\s+)?test\b|\bjest\b|\bvitest\b|\bspecs?\b/, 'a test run'],
];
const PRE_PUSH_FORBIDDEN = [
  [/\bnpm\s+(?:run\s+)?test\b|\btest:|\bjest\b|\bvitest\b/, 'a test run'],
  [/\btypecheck\b/, 'a typecheck'],
  [/\blint\b/, 'a lint run'],
];
const PRE_PUSH_MARKERS = ["node --input-type=module -e", "import { main } from '@starci/hfs/runtime/scripts/guards/release-push-gate.mjs'", 'process.exit(await main())'];

const finding = (file, message) => ({ code: CODE, level: 'error', path: file, message: `${CODE} ${file}: ${message}` });

/** The RT_HOOK_SHAPE findings of one hook template: `name` is 'pre-commit' or 'pre-push', `text` its content. */
function fileHookShapeFindings({ path: file, name, text }) {
  const body = shellCommandSource(text);
  const found = [];
  const forbidden = name === 'pre-commit' ? PRE_COMMIT_FORBIDDEN : PRE_PUSH_FORBIDDEN;
  for (const [pattern, what] of forbidden) {
    if (pattern.test(body)) found.push(finding(file, name === 'pre-commit' ? `the commit gate is L0 only and runs ${what}; types and targeted specs belong to the op gate` : `the push gate runs ${what}; it must use the bundled push policy alone`));
  }
  if (name === 'pre-push') {
    const missing = PRE_PUSH_MARKERS.filter((marker) => !body.includes(marker));
    if (missing.length) {
      const markers = missing.map((m) => `\`${m}\``).join(', ');
      found.push(finding(file, `the push gate lacks the bundled gate marker${missing.length === 1 ? '' : 's'} ${markers}; it must invoke the shared fast-forward, annotation and secret-scan policy`));
    }
  }
  return found;
}

/** Guard hooks finish inside the host timeout even when input, verdict, tree cleanup and both writes exhaust their budgets. */
function guardTimeoutFindings(ctx) {
  if (!ctx.fileSet.has(HOST_SETTINGS)) return [];
  const limits = HOOK_INPUT_LIMITS;
  const budget = limits.minInputWindowMs + limits.verdictTimeoutMs + limits.teardownTimeoutMs + 2 * limits.outputTimeoutMs;
  const found = budget < limits.hookTimeoutSeconds * 1000 ? [] : [finding(GUARD_LIMITS, 'the complete guard lifetime must be shorter than the host hook timeout')];
  let settings;
  try { settings = JSON.parse(ctx.read(HOST_SETTINGS)); }
  catch { return [...found, finding(HOST_SETTINGS, 'the guard hook settings must be readable JSON')]; }
  const hooks = (settings?.hooks?.PreToolUse ?? []).flatMap((entry) => entry.hooks ?? []);
  for (const hook of hooks) {
    if (!/\bguard\s+(?:command|seat-tools)\b/.test(String(hook.command ?? ''))) continue;
    if (hook.timeout !== limits.hookTimeoutSeconds) found.push(finding(HOST_SETTINGS, `the guard hook timeout must match ${GUARD_LIMITS} hookTimeoutSeconds`));
  }
  return found;
}

/** RT_HOOK_SHAPE over the app hook templates and tracked host guard settings (ctx of scripts/hfs/runtime-check.mjs). */
export function hookShapeFindings(ctx) {
  return [...guardTimeoutFindings(ctx), ...[['pre-commit', PRE_COMMIT], ['pre-push', PRE_PUSH]].flatMap(([name, file]) => {
    if (!ctx.fileSet.has(file)) return [];
    const text = ctx.read(file);
    return text === null || text === undefined ? [] : fileHookShapeFindings({ path: file, name, text });
  })];
}
