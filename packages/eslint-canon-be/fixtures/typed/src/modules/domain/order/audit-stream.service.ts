import type { Observable } from "rxjs"

/** Fixture: a second stream read service. */
export declare class AuditStreamService {
    open(principal: { id: string }, after?: string): Observable<object>
}
