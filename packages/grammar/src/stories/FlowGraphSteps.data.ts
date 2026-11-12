import { BanknotesIcon, DocumentTextIcon, MagnifyingGlassIcon, MegaphoneIcon, PencilSquareIcon, UserCircleIcon } from '@heroicons/react/24/outline';
import type * as G from '../common/index.js';

/**
 * The payment flow "Payment received" (money in, matched to an order) drawn as a `steps` graph: an event starts it, two conditions
 * fork it through named ports, a wait and an ask need the owner, and two dashed back edges return to "Mark as paid".
 */
export const reconcileNodes: ReadonlyArray<G.FlowGraphNode> = [
  { id: 'money-in', kind: 'event', label: 'Payment received', description: 'New incoming payment', tag: 'Trigger', icon: BanknotesIcon },
  { id: 'find-order', kind: 'action', label: 'Find order ID', description: 'Read the payment note', icon: MagnifyingGlassIcon },
  { id: 'has-order', kind: 'condition', label: 'Has order ID?', description: 'Order ID in the note', outputs: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] },
  { id: 'amount-ok', kind: 'condition', label: 'Enough amount?', description: 'Compare to order total', outputs: [{ id: 'match', label: 'Match' }, { id: 'off', label: 'Off' }] },
  { id: 'note-unmatched', kind: 'action', label: 'Note unmatched', description: 'Save to the match log', icon: PencilSquareIcon },
  { id: 'wait-owner', kind: 'wait', label: 'Wait for manual match', description: 'Owner picks the order', tag: 'Wait' },
  { id: 'ask-owner', kind: 'ask', label: 'Ask the owner', description: 'Report the amount gap', tag: 'Needs owner', icon: UserCircleIcon },
  { id: 'mark-paid', kind: 'action', label: 'Mark as paid', description: 'Flag the order as paid', icon: DocumentTextIcon },
  { id: 'tell-sales', kind: 'event', label: 'Notify team', description: 'Send by Email or Webhook', icon: MegaphoneIcon },
  { id: 'done', kind: 'end', label: 'Done' },
];

export const reconcileEdges: ReadonlyArray<G.FlowGraphEdge> = [
  { id: 'e-in-find', source: 'money-in', target: 'find-order' },
  { id: 'e-find-has', source: 'find-order', target: 'has-order' },
  { id: 'e-has-yes', source: 'has-order', target: 'amount-ok', sourcePort: 'yes' },
  { id: 'e-has-no', source: 'has-order', target: 'note-unmatched', sourcePort: 'no' },
  { id: 'e-note-wait', source: 'note-unmatched', target: 'wait-owner' },
  { id: 'e-amount-match', source: 'amount-ok', target: 'mark-paid', sourcePort: 'match' },
  { id: 'e-amount-off', source: 'amount-ok', target: 'ask-owner', sourcePort: 'off' },
  { id: 'e-paid-sales', source: 'mark-paid', target: 'tell-sales' },
  { id: 'e-sales-done', source: 'tell-sales', target: 'done' },
  { id: 'b-ask-paid', source: 'ask-owner', target: 'mark-paid', variant: 'back', label: 'owner approves' },
  { id: 'b-wait-paid', source: 'wait-owner', target: 'mark-paid', variant: 'back', label: 'owner matches' },
];

export const reconcileLegend: ReadonlyArray<G.FlowGraphLegendItem> = [
  { kind: 'event', label: 'Event' },
  { kind: 'action', label: 'Action' },
  { kind: 'condition', label: 'Condition' },
  { kind: 'ask', label: 'Needs owner' },
  { kind: 'wait', label: 'Wait' },
];

export const reconcileStatusLabels: Partial<Record<G.FlowGraphRunStatus, string>> = {
  done: 'Done',
  running: 'Running',
  failed: 'Failed',
  waiting: 'Waiting for you',
  skipped: 'Skipped',
};

/** A run of the flow: the money matched an order of the right amount; the run is at "Notify team". */
const matchedStatus: Readonly<Record<string, G.FlowGraphRunStatus>> = {
  'money-in': 'done',
  'find-order': 'done',
  'has-order': 'done',
  'amount-ok': 'done',
  'mark-paid': 'done',
  'tell-sales': 'running',
  'note-unmatched': 'skipped',
  'wait-owner': 'skipped',
  'ask-owner': 'skipped',
  done: 'skipped',
};
const matchedTaken = new Set(['e-in-find', 'e-find-has', 'e-has-yes', 'e-amount-match', 'e-paid-sales']);

/** A second run: the amount was off, the owner was asked and has not answered. */
const offStatus: Readonly<Record<string, G.FlowGraphRunStatus>> = {
  'money-in': 'done',
  'find-order': 'done',
  'has-order': 'done',
  'amount-ok': 'done',
  'ask-owner': 'waiting',
  'note-unmatched': 'skipped',
  'wait-owner': 'skipped',
};
const offTaken = new Set(['e-in-find', 'e-find-has', 'e-has-yes', 'e-amount-off']);

/** A third run: reading the transfer failed. */
const failedStatus: Readonly<Record<string, G.FlowGraphRunStatus>> = { 'money-in': 'done', 'find-order': 'failed' };
const failedTaken = new Set(['e-in-find']);

/** A fourth run: no order code in the transfer, noted, and the wait card needs the owner to match it by hand. */
const waitStatus: Readonly<Record<string, G.FlowGraphRunStatus>> = {
  'money-in': 'done',
  'find-order': 'done',
  'has-order': 'done',
  'note-unmatched': 'done',
  'wait-owner': 'waiting',
  'amount-ok': 'skipped',
  'mark-paid': 'skipped',
  'tell-sales': 'skipped',
  'ask-owner': 'skipped',
  done: 'skipped',
};
const waitTaken = new Set(['e-in-find', 'e-find-has', 'e-has-no', 'e-note-wait']);

const runOf = (status: Readonly<Record<string, G.FlowGraphRunStatus>>, taken: ReadonlySet<string>) => ({
  nodes: reconcileNodes.map((node): G.FlowGraphNode => {
    const at = status[node.id];
    return at === undefined ? node : { ...node, status: at };
  }),
  edges: reconcileEdges.map((edge) => ({ ...edge, isTaken: taken.has(edge.id) })),
});

export const reconcileRunMatched = runOf(matchedStatus, matchedTaken);
export const reconcileRunOff = runOf(offStatus, offTaken);
export const reconcileRunFailed = runOf(failedStatus, failedTaken);
export const reconcileRunWait = runOf(waitStatus, waitTaken);
