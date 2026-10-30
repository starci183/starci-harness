// in-order.mjs — asynchronous work done strictly one after another, named by what it does. A sequential `await` in a
// loop is often the point (ordered ledger writes, one Orca or git call at a time, a rate limit, stop at the first
// failure or match); these helpers state that intent at the call site so no loop body carries an `await`. Each one
// starts item n+1 only after item n has settled, lets the first rejection (or a synchronous throw of `fn`) stop the run
// with later items never started, pulls a lazy iterable one item at a time, and closes it on an early stop, the way
// `for (const x of xs) await fn(x)` does. All of them run on the one `walk` below: promise callbacks, not an async
// recursion, so the stack and the memory stay flat however long the input is.
// Provably independent work that needs no order, short-circuit or error contract may use `Promise.all` instead.

/** Close `iterator` the way a `for...of` leaves it: `return()` when it has one. */
const close = (iterator: Iterator<unknown>): unknown => iterator.return?.();

/** A walk decision that ends the walk with `value`. */
interface Box<R> { value: R }

/**
 * Drive `visit(item, index)` over `items` one at a time. `decide(outcome, item)` runs after each settled visit: a
 * `{ value }` box ends the walk with that value, anything else goes on. Resolves with the box value, or `undefined` when
 * the items ran out; rejects with the first rejection or throw, after closing the iterator.
 */
const walk = <T, V, R>(
  items: Iterable<T>,
  visit: (item: T, index: number) => V | PromiseLike<V>,
  decide: (outcome: V, item: T) => Box<R> | undefined,
): Promise<R | undefined> => new Promise<R | undefined>((resolve, reject) => {
  const iterator = items[Symbol.iterator]();
  let index = 0;
  const fail = (error: unknown): void => {
    try { close(iterator); } catch { /* the failure being reported wins, as it does in a for...of */ }
    reject(error);
  };
  const stop = (value: R): void => {
    try { close(iterator); } catch (error) { reject(error); return; }
    resolve(value);
  };
  const advance = (): void => {
    let step: IteratorResult<T> | undefined, pending: V | PromiseLike<V>;
    try {
      step = iterator.next();
      if (step.done) { resolve(undefined); return; }
      pending = visit(step.value, index++);
    } catch (error) {
      if (step === undefined || step.done) reject(error); else fail(error);
      return;
    }
    const item = step.value;
    Promise.resolve(pending).then((outcome) => {
      let box: Box<R> | undefined;
      try { box = decide(outcome, item); } catch (error) { fail(error); return; }
      if (box) stop(box.value); else advance();
    }, fail);
  };
  advance();
});

const never = (): undefined => undefined;

/** `for (const x of items) await fn(x, index)`: resolves undefined once every item has run, one at a time. */
export const eachInOrder = <T,>(items: Iterable<T>, fn: (item: T, index: number) => unknown): Promise<undefined> => walk<T, unknown, undefined>(items, fn, never);

/** The sequential map: `fn(x, index)` for each item in turn, resolving the results in item order. */
export const mapInOrder = <T, U>(items: Iterable<T>, fn: (item: T, index: number) => U | PromiseLike<U>): Promise<U[]> => {
  const results: U[] = [];
  return walk<T, U, never>(items, fn, (outcome) => { results.push(outcome); return undefined; }).then(() => results);
};

/** The first item whose `predicate(x, index)` resolves truthy (undefined when none); later items never run. */
export const findInOrder = <T,>(items: Iterable<T>, predicate: (item: T, index: number) => unknown): Promise<T | undefined> => walk<T, unknown, T>(items, predicate, (outcome, item) => (outcome ? { value: item } : undefined));

/**
 * `for (;;) await step(attempt)`: `step(attempt)` runs again, after the previous run settled, until it resolves
 * something other than undefined; that value (null included) is the result. A poll or retry returns undefined to go
 * on and its answer to stop. `attempt` counts from 0.
 */
export const repeatInOrder = <R,>(step: (attempt: number) => R | undefined | PromiseLike<R | undefined>): Promise<R | undefined> => walk<number, R | undefined, R>(forever(), step, (outcome) => (outcome === undefined ? undefined : { value: outcome }));

function* forever(): Generator<number> {
  for (let attempt = 0; ; attempt++) yield attempt;
}
