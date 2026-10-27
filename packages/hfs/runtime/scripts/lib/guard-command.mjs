// guard-command.mjs — the one spelling of the hook command that registers a StarCi guard verb with an agent host.
//
// A host chooses the shell that runs a hook. The linked runtime supplies the absolute CLI path shared by launch trust
// and preflight. Hook deadlines belong to the guard process; shell termination does not bound native children on Windows.
import process from 'node:process';
import path from 'node:path';
import { readRuntimeRecord } from './runtime-location.mjs';

const GUARD_COMMAND_END = /starci(?:\.mjs|\.cmd)?"? guard command$/;
const quotedPath = (file) => `"${String(file).replaceAll('\\', '/')}"`;

/** The command guard hook for the linked runtime; a missing or stale runtime record refuses registration. */
export function toolGuardCommand({ home, nodePath = process.execPath, cliPath = null } = {}) {
  if (!cliPath) {
    const skipped = [];
    const installed = readRuntimeRecord({ home, skipped });
    if (!installed) throw new Error(skipped.join('; ') || 'no linked runtime; run starci runtime link');
    cliPath = path.join(installed.root, 'packages', 'cli', 'bin', 'starci.mjs');
  }
  return `${quotedPath(nodePath)} ${quotedPath(cliPath)} guard command`;
}

/** Recognize the direct Node hook and launcher spellings so trust preparation replaces an older registered guard. */
export const isGuardCommand = (command) => GUARD_COMMAND_END.test(String(command ?? ''));
