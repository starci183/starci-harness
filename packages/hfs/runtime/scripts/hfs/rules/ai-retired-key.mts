// ai-retired-key.mjs - HFS_AI_RETIRED_KEY (R344): an app's ai-router gateway has one client key, `STARCI_AI_KEY`, sealed in
// the `ai` member and used by the api and the agent runtime alike, and no admin token. The names it replaced (the per-caller
// `AI_API_KEY` and `OPENCLAW_AI_KEY`, the admin `AI_ROUTER_ADMIN_TOKEN`, and their `_FILE` twins) are refused in every
// tracked text file the canon lint does not read: the stack manifest, env examples, compose and swarm files, entrypoints,
// init scripts and docs. TypeScript is the canon lint's (`@starci/eslint-canon-be` `ai-virtual-key-name`), and a sealed
// envelope is never read. A finding names the file, the line and the name, never a value.
import { found, readText } from './read.mjs';

const RETIRED_KEY = 'HFS_AI_RETIRED_KEY';

/** The retired names as whole words: `OPENAI_API_KEY` or `STARCI_AI_KEY` never match `AI_API_KEY`. */
const RETIRED = /(?<![A-Za-z0-9_])(AI_API_KEY|OPENCLAW_AI_KEY|AI_ROUTER_ADMIN_TOKEN)(?:_FILE)?(?![A-Za-z0-9_])/;

/** Files this finder leaves alone: the canon lint's TypeScript, sealed envelopes, lockfiles and release history. */
const NOT_JUDGED = /\.(?:[cm]?ts|tsx)$|\.enc(?:\.yaml)?$|(?:^|\/)package-lock\.json$|(?:^|\/)CHANGELOG\.md$/;

/** The findings of R344 over the tracked files of an app: one per file, at the first line naming a retired AI key. */
export function aiRetiredKeyFindings({ repoRoot, files, inScope }: { repoRoot: string; files: string[]; inScope?: (file: string) => boolean }) {
  const findings = [];
  for (const file of files) {
    const posix = file.replaceAll('\\', '/');
    if (NOT_JUDGED.test(posix) || (inScope && !inScope(file))) continue;
    const text = readText(repoRoot, file);
    if (text === null) continue;
    const lines = text.split(/\r?\n/);
    const at = lines.findIndex((line: string) => RETIRED.test(line));
    if (at < 0) continue;
    const name = RETIRED.exec(lines[at] as string)?.[1] ?? '';
    findings.push(found(RETIRED_KEY, file,
      `${file}:${at + 1} names the retired AI key ${name}; the app has one gateway virtual key, STARCI_AI_KEY (sk-starci-<app>-<48 hex>, sealed in the ai member and granted to the api and the agent runtime), and the gateway has no admin token`,
      { line: at + 1, name }));
  }
  return findings;
}
