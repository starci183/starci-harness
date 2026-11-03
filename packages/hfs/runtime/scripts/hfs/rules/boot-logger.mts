// R376: a back-end app root boots loudly. Its main.ts never hands Nest `logger: false` (NestFactory or nest-commander's
// CommandFactory): with the logger off, a provider a module needs and the root does not compose ends every boot silently, and a
// CLI command dies with no line on stderr. The template passes the app's JSON logger and an error handler that prints and exits non-zero.
// Judged: every tracked `be/apps/<app>/src/main.ts`, read through readText, comments stripped; only the main of an app root, so a test
// world that compiles a root quietly on purpose is not judged.
import { found, readText } from './read.mjs';
import type { Repo, Resolver } from './rule-types.mjs';

export const HFS_BOOT_LOGGER_SILENCED = 'HFS_BOOT_LOGGER_SILENCED';

const APP_MAIN = /^be\/apps\/[^/]+\/src\/main\.ts$/u;
const COMMENT = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu;
const SILENCED = /\blogger\s*:\s*false\b/u;

/** The R376 findings: an app root main that turns the Nest logger off. */
export function bootLoggerFindings({ repoRoot, files = [], all = files, repo, isRoot, inScope = () => true }: { repoRoot: string; files?: string[]; all?: string[]; repo: Repo; resolver?: Resolver; isRoot: boolean; inScope?: (file: string) => boolean }) {
  if (repo?.kind !== 'app' || isRoot === false) return [];
  return [...new Set(all)].filter((file) => APP_MAIN.test(file) && inScope(file)).flatMap((file) => {
    const text = readText(repoRoot, file);
    return text !== null && SILENCED.test(text.replace(COMMENT, ''))
      ? [found(HFS_BOOT_LOGGER_SILENCED, file, `${file} boots Nest with logger: false, so a DI or bootstrap failure ends the process silently; pass the app's logger and an error handler that prints and exits non-zero (R376)`)]
      : [];
  });
}
