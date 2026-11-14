import type { Observable } from "rxjs"

/** Fixture: a service that streams and also writes, so it is no stream read service. */
export declare class MixedStreamService {
    open(principal: { id: string }): Observable<object>
    write(id: string): Promise<void>
}
