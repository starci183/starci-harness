import type { Observable } from "rxjs"

/** Fixture: a stream read service of the order capability: its one method reads the current state and answers the live frames. */
export declare class OrderStreamService {
    open(principal: { id: string }, room: string, after?: string): Observable<object>
}
