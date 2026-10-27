/** What an interceptor may return: the (possibly new) value, nothing to keep the mutated one, or `null` where the manager allows dropping. */
export type InterceptorResult<V, Drop> = V | void | Drop

/** One interceptor function. */
export type Interceptor<V, Drop = never> = (value: V) => InterceptorResult<V, Drop> | Promise<InterceptorResult<V, Drop>>

/** The registry of one interceptor chain, as `axios.interceptors.request`. Interceptors run in the order they were added. */
export interface InterceptorRegistry<V, Drop = never> {
  /** Adds an interceptor and returns its id. */
  use(interceptor: Interceptor<V, Drop>): number
  /** Removes the interceptor with this id (a no-op when it is gone). */
  eject(id: number): void
  /** Removes every interceptor. */
  clear(): void
}

/** The registry plus the runner the client uses. */
export class InterceptorChain<V, Drop = never> implements InterceptorRegistry<V, Drop> {
  readonly #handlers = new Map<number, Interceptor<V, Drop>>()
  #next = 0

  use(interceptor: Interceptor<V, Drop>): number {
    const id = this.#next++
    this.#handlers.set(id, interceptor)
    return id
  }

  eject(id: number): void {
    this.#handlers.delete(id)
  }

  clear(): void {
    this.#handlers.clear()
  }

  /** Passes `value` through every interceptor in order; an interceptor returning `null` stops the chain and the result is `null`. */
  async run(value: V): Promise<V | Drop> {
    let current = value
    for (const handler of [...this.#handlers.values()]) {
      const result = await handler(current)
      if (result === null) return result
      if (result !== undefined) current = result as V
    }
    return current
  }
}
