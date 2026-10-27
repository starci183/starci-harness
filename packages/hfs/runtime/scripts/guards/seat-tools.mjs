#!/usr/bin/env node
// seat-tools.mjs — the Claude Code PreToolUse hook that enforces a seat's denied tools (.claude/settings.json).
// worker-start takes no provider argv, so a seat launched through it cannot carry --disallowedTools: the runtime binds
// the seat's terminal instead (scripts/guards/hook-install.mjs bindSeatGuard -> <guards root>/seats/<handle>.json) and this
// hook denies exactly those tools for exactly that terminal (ORCA_TERMINAL_HANDLE, which Orca exports into it).
// Every other session - no Orca handle, or a handle with no seat guard - passes untouched.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundGuard, boundSeat } from './rights.mjs';
import { hookErrorMessage, readInput, writeHookOutput } from './hook-io.mjs';
import { isMain } from '../lib/is-main.mjs';
import { readEnv } from '../lib/env.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The deny decision for one hook input, or null to pass: {reason} when `toolName` is denied for `handle`. */
function seatToolDecision({ handle, toolName, guard }) {
  if (!handle || !toolName) return null;
  if (!Array.isArray(guard?.deniedTools) || !guard.deniedTools.includes(toolName)) return null;
  return { reason: `${toolName} is denied for the ${guard.role ?? 'seat'} (${handle}): in-process subagents are outside the Supervisor's menu - answer the menu with starci supervisor decide, or record a runtime defect with starci supervisor actions record --item runtime-defect:<cause> (modules/supervisor/supervisor-prompt.md).` };
}

/** Exported hook entry for the published CLI's in-process guard fast path. */
export async function main({ stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, env = process.env, root = skillRoot } = {}) {
  const handle = readEnv('ORCA_TERMINAL_HANDLE', env);
  const seat = boundSeat(handle, { root, env });
  const enforced = Boolean(seat || boundGuard(handle, { root, env }) || readEnv('STARCI_ROLE', env));
  let toolName = null;
  try { toolName = JSON.parse(await readInput(stdin))?.tool_name ?? null; }
  catch (error) {
    const reason = `seat-tools error (${hookErrorMessage(error)})`;
    const outcome = enforced ? 'refusing the tool' : 'passing the tool through';
    await writeHookOutput(stderr, `starci guard: ${reason}; ${outcome}\n`).catch(() => false);
    if (enforced) await denyTool(stdout, reason);
    return enforced ? 2 : 0;
  }
  if (toolName) {
    const decision = seatToolDecision({ handle, toolName, guard: seat });
    if (decision && !await denyTool(stdout, decision.reason)) return 2;
  }
  return 0;
}

/** Deliver a Claude denial within the output budget; failed delivery keeps the hook's blocking exit. */
const denyTool = (stdout, reason) => writeHookOutput(stdout, `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } })}\n`).catch(() => false);

if (isMain(import.meta.url)) process.exit(await main());
