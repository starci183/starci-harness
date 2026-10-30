// GitHub workflow `on` supports a scalar event, an event list or an options map.

/** Convert shorthand workflow events into an options map; mappings retain their values. */
export function workflowEventOptions<T>(on: string | readonly string[] | T, eventName: (event: string) => string = (event) => event): Record<string, null> | T {
  if (typeof on === 'string') return { [on]: null };
  if (Array.isArray(on)) return Object.fromEntries(on.map((event: string) => [eventName(event), null]));
  return on as T;
}
