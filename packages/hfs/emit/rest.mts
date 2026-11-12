/**
 * The REST contract of an api app whose hfs.json entry declares `contract: "rest"` (runtime/scripts/hfs/contract-kind.mts): the OpenAPI 3
 * document rest-worker.mts builds, written to `contracts/<app>/openapi.json` with every object's keys sorted, so the file is a function of
 * the code and a drift is a real change.
 */
export { openapiHeadPath } from '../runtime/scripts/hfs/contract-kind.mjs';

/** `value` with the keys of every object sorted (arrays keep their order). Pure. */
export function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedKeys((value as Record<string, unknown>)[key])]));
}

/** The text of a REST contract snapshot: the document with sorted keys, two-space indented. Pure. */
export const restDocumentText = (document: unknown): string => JSON.stringify(sortedKeys(document), null, 2);
