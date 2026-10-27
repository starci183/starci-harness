/**
 * `fakeIds()` -- the test double for the platform ids port (`{ next(): string }`; the production adapter is
 * `randomUUID()` behind the port). Ids are deterministic and UUID-shaped, so a spec can assert on the exact persisted id:
 * the first is `00000000-0000-4000-8000-000000000001`, the second `...0002`, and so on. A `prefix` (1 to 8 hex digits)
 * changes the leading group so two generators in one spec never collide.
 */

/** The platform ids port a spec injects `fakeIds()` for: `{ next(): string }`. */
export class FakeIds {
  private readonly _prefix: string
  private _issued: string[]

  /** @param prefix - 1 to 8 hex digits for the first group; default "00000000". */
  constructor(prefix = "00000000") {
    if (!/^[0-9a-f]{1,8}$/i.test(prefix)) throw new Error("fakeIds: the prefix is 1 to 8 hex digits")
    this._prefix = prefix.padStart(8, "0").toLowerCase()
    this._issued = []
  }

  /** The next deterministic UUID-shaped id. */
  next(): string {
    const n = String(this._issued.length + 1).padStart(12, "0")
    const id = `${this._prefix}-0000-4000-8000-${n}`
    this._issued.push(id)
    return id
  }

  /** Every id handed out so far, in order. */
  get issued(): ReadonlyArray<string> {
    return [...this._issued]
  }

  /** Starts the sequence over. */
  reset(): void {
    this._issued = []
  }
}

/** A deterministic id generator: `00000000-0000-4000-8000-000000000001`, `...0002`, ... */
export function fakeIds(prefix?: string): FakeIds {
  return new FakeIds(prefix)
}
