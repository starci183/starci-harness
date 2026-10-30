// chunk.mjs - split a long argument list under the command-line limit (Windows allows 32,767 characters) and run the parts with bounded concurrency.

/** The command-line characters one argument costs: its length, a separating space and a pair of quotes. */
const cost = (arg: unknown): number => String(arg).length + 3;

/**
 * Split `items` into consecutive chunks whose summed command-line cost stays within `budget` characters. Order is kept. An item that alone
 * exceeds the budget gets a chunk of its own (the spawn then fails visibly instead of being dropped).
 */
export function chunkByChars<T>(items: readonly T[], budget = 24_000): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [], used = 0;
  for (const item of items) {
    const size = cost(item);
    if (current.length && used + size > budget) { chunks.push(current); current = []; used = 0; }
    current.push(item);
    used += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/** Run `task(chunk)` for every chunk with at most `limit` in flight. Results keep the chunk order; a thrown task becomes `{ error }`. */
export async function mapBounded<C, R>(chunks: readonly C[], task: (chunk: C, index: number) => Promise<R> | R, limit = 3): Promise<(R | { error: string })[]> {
  const out: (R | { error: string })[] = new Array(chunks.length);
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const at = next++;
      try { out[at] = await task(chunks[at] as C, at); } catch (error) { out[at] = { error: `could not start a lint child: ${String((error as Error | undefined)?.message ?? error)}` }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, chunks.length) }, worker));
  return out;
}

/** Merge the `{ results, error }` records of the chunks, in chunk order: every result kept, every distinct error reported. */
export function mergeRuns<R>(runs: readonly ({ results?: readonly R[]; error?: string } | undefined)[]): { results?: R[]; error?: string } {
  const results: R[] = [], errors: string[] = [];
  let any = false;
  for (const run of runs) {
    if (run?.results) { results.push(...run.results); any = true; }
    if (run?.error && !errors.includes(run.error)) errors.push(run.error);
  }
  return { ...(any ? { results } : {}), ...(errors.length ? { error: errors.join(' ; ') } : {}) };
}
