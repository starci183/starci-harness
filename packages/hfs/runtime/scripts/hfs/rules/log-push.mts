// log-push.mts - an app whose environment pushes its back end's logs to Loki carries the transport that does it (contexts/code/be/logging.md
// BE-LOGGING-1, contexts/project/monitoring.md PROJECT-MONITORING-2):
//   BE_LOGGER_REQUIRED (R40)  an environment of `.starcistacks/application-stacks.yaml` declares `monitoring.logPush` (its services ship their
//                             own lines to Loki, and the server's Alloy no longer collects their stdout), but no tracked source of the back end's
//                             `platform/logging` imports `winston-loki`: the render hands those services LOKI_URL and nothing sends to it, so
//                             their logs reach no store at all. Read from the tracked tree only: the declaration and the logging sources.
import { parseYaml } from '../../../engine/yaml.mjs';
import { isPlainObject as plain } from '../../../engine/plain-object.mjs';
import { DECLARATION, STACK_ROOT } from '../../lib/stack-declaration.mjs';
import { found, readText } from './read.mjs';
import type { Finding, Parsed } from './rule-types.mjs';

export const BE_LOGGER_REQUIRED = 'BE_LOGGER_REQUIRED';
const STACKS = `${STACK_ROOT}/${DECLARATION}`;
const LOGGING = 'be/src/modules/platform/logging/';
/** A static or dynamic import, or a require, of the transport package. */
const TRANSPORT_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["']winston-loki["']/u;

/** The environments that declare a non-empty `monitoring.logPush`, in declaration order. */
function pushingEnvironments(doc: Parsed): string[] {
  const environments = plain(doc?.environments) ? doc.environments : {};
  return Object.entries<Parsed>(environments).filter(([, spec]) => Array.isArray(spec?.monitoring?.logPush) && spec.monitoring.logPush.length > 0).map(([name]) => name);
}

/** R40 findings of an app root: `all` is every tracked path of the app, app-relative. */
export function logPushFindings({ repoRoot, all }: { repoRoot: string; all: readonly string[] }): Finding[] {
  if (!all.includes(STACKS)) return [];
  const text = readText(repoRoot, STACKS);
  if (text === null) return [];
  let doc: Parsed;
  try { doc = parseYaml(text); } catch { return []; }
  const pushing = pushingEnvironments(doc);
  if (pushing.length === 0) return [];
  const sources = all.filter((file) => file.startsWith(LOGGING) && /\.ts$/u.test(file) && !/\.spec\.ts$/u.test(file));
  if (sources.some((file) => TRANSPORT_IMPORT.test(readText(repoRoot, file) ?? ''))) return [];
  return [found(BE_LOGGER_REQUIRED, LOGGING, `${STACKS} pushes logs to Loki (monitoring.logPush of ${pushing.join(', ')}), but no source of ${LOGGING} imports winston-loki: the pushed services get LOKI_URL and their stdout is no longer collected, so their lines reach no store. Bring platform/logging to the Winston adapter with its Loki transport (BE-LOGGING-1), or remove logPush`)];
}
