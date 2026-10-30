import { isPlainObject } from '../../engine/plain-object.mjs';

/** Compose mapping/list entries; callers choose how bare keys and non-string list items are interpreted. */
export function composeEntries(
  value: unknown,
  { missingValue = '', stringsOnly = false, isMapping = isPlainObject }: { missingValue?: unknown; stringsOnly?: boolean; isMapping?: (value: unknown) => boolean } = {},
): [string, unknown][] {
  if (!Array.isArray(value)) return Object.entries(isMapping(value) ? (value as Record<string, unknown>) : {});
  const entries: unknown[] = stringsOnly ? value.filter(entry => typeof entry === 'string') : value;
  return entries.map((entry): [string, unknown] => {
    const text = String(entry), separator = text.indexOf('=');
    return separator < 0 ? [text, missingValue] : [text.slice(0, separator), text.slice(separator + 1)];
  });
}
