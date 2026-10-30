// mutation-fence.mjs — ephemeral admission carried through awaited work, never a state store.
import { AsyncLocalStorage } from 'node:async_hooks';
/** The boundary a write owner rechecks at: its kind and the details of the effect (the db, the name, the argv). */
export interface FenceBoundary { kind: string; [detail: string]: unknown }
interface FenceScope<A> { check: (boundary: FenceBoundary) => void; authority: A; checking: boolean }
const scope = new AsyncLocalStorage<FenceScope<unknown>>();

/** Run one admitted call; the checker is synchronous and reads its existing durable owners again. */
export const withMutationFence = <A, R>(check: (boundary: FenceBoundary) => void, authority: A, fn: () => R): R => scope.run({ check, authority, checking: false }, fn);
/** Recheck after the actual transaction lock or immediately before a native effect. */
export function assertMutationFence(boundary: FenceBoundary): void {
  const current = scope.getStore();
  if (!current || current.checking) return;
  current.checking = true;
  try { current.check(boundary); } finally { current.checking = false; }
}
/** Identity stamped by existing write owners, never accepted from a command argument. */
export const mutationAuthority = (): unknown => scope.getStore()?.authority ?? null;
