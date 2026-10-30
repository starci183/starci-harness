// event-items.mjs - the open items of an owed/resolved event pair, replayed from a workflow ledger (read only).

import type { SqliteDb } from './sqlite.mjs';

/** The payload of a workflow event, parsed from its ledger column (an open record: each event kind carries its own fields). */
export type EventPayload = Record<string, unknown>;
/** The columns of an event row this replay reads. */
export interface EventRow { kind: string; payload_json: string | null; created_at: string }

/**
 * The workflow's open items of an owed/resolved event pair (grammar proposals, asset slots): replay the kinds in seq
 * order — a `resolvedKind` row deletes the item `keyOf` names, an `owedKind` row sets `item(payload,row)`; a row
 * whose key is falsy is skipped. Returns the open items in first-seen order, [] when the table cannot be read.
 */
export function openEventItems<Item>(
  db: SqliteDb,
  workflowId: unknown,
  {owedKind,resolvedKind,keyOf,item}: {
    owedKind: string;
    resolvedKind: string;
    keyOf: (payload: EventPayload) => unknown;
    item: (payload: EventPayload, row: EventRow) => Item;
  },
): Item[] {
  let rows: EventRow[]=[];
  try{rows=db.prepare('SELECT kind,payload_json,created_at FROM events WHERE workflow_id=? AND kind IN (?,?) ORDER BY seq').all<EventRow>(workflowId,owedKind,resolvedKind);}
  catch{return[];}
  const open=new Map<unknown,Item>();
  for(const row of rows){
    let p: EventPayload={};
    try{p=JSON.parse(row.payload_json??'{}')??{};}catch{p={};}
    const key=keyOf(p);
    if(!key)continue;
    if(row.kind===resolvedKind){open.delete(key);continue;}
    open.set(key,item(p,row));
  }
  return[...open.values()];
}
