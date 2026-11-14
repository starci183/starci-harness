import type * as G from '../common/index.js';

/**
 * The fixtures of `FlowGraphDecisionLoop.stories.tsx` (0.39.1): a payment loop the way a workflow map draws it, a dashed loop frame round a body of 4 or of 13 cards
 * (6 of them decision diamonds), two ways out on the frame's edge leading to cards outside it, and a dashed fallback road (a wait that timed out).
 */
const yesNo: ReadonlyArray<G.FlowGraphPort> = [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }];
const decision = (id: string, label: string): G.FlowGraphNode => ({ id, kind: 'condition', shape: 'diamond', label, outputs: yesNo });
const step = (id: string, label: string, description?: string): G.FlowGraphNode => ({ id, kind: 'action', label, ...(description === undefined ? {} : { description }) });

const waitForCredit: G.FlowGraphNode = {
  id: 'wait',
  kind: 'wait',
  label: 'Wait for a credit',
  description: 'Credit or a message, up to 1 day',
  outputs: [{ id: 'credit', label: 'Credit' }, { id: 'message', label: 'Message' }, { id: 'timeout', label: 'Timed out' }],
};

type Body = { readonly nodes: ReadonlyArray<G.FlowGraphNode>; readonly edges: ReadonlyArray<G.FlowGraphEdge> };

/** The body of 4: the wait, one decision and its two branches. */
export const body4: Body = {
  nodes: [waitForCredit, decision('enough', 'Enough paid?'), step('record', 'Record the payment'), step('short', 'Tell the shortfall', 'The amount still due')],
  edges: [
    { id: 'b-credit', source: 'wait', target: 'enough', sourcePort: 'credit' },
    { id: 'b-yes', source: 'enough', target: 'record', sourcePort: 'yes' },
    { id: 'b-no', source: 'enough', target: 'short', sourcePort: 'no' },
  ],
};

/** The body of 13 (the size of a real payment loop): the wait, 6 decisions and 6 steps; the timed-out road is the dashed fallback. */
export const body13: Body = {
  nodes: [
    waitForCredit,
    decision('enough', 'Enough paid?'),
    step('record', 'Record the payment'),
    decision('little', 'Short by a little?'),
    step('rest', 'Ask for the rest'),
    step('short', 'Tell the shortfall', 'The amount still due'),
    decision('cancel', 'Asks to cancel?'),
    decision('paid', 'Paid already?'),
    step('answer', 'Answer the question'),
    decision('reminded', 'Reminded already?'),
    step('remind', 'Send a reminder', 'The payment link again'),
    decision('sent', 'Reminder sent?'),
    step('team', 'Tell the team'),
  ],
  edges: [
    { id: 'b-credit', source: 'wait', target: 'enough', sourcePort: 'credit' },
    { id: 'b-message', source: 'wait', target: 'cancel', sourcePort: 'message' },
    { id: 'b-timeout', source: 'wait', target: 'reminded', sourcePort: 'timeout', isFallback: true },
    { id: 'b-yes', source: 'enough', target: 'record', sourcePort: 'yes' },
    { id: 'b-no', source: 'enough', target: 'little', sourcePort: 'no' },
    { id: 'b-little-yes', source: 'little', target: 'rest', sourcePort: 'yes' },
    { id: 'b-little-no', source: 'little', target: 'short', sourcePort: 'no' },
    { id: 'b-cancel-yes', source: 'cancel', target: 'paid', sourcePort: 'yes' },
    { id: 'b-cancel-no', source: 'cancel', target: 'answer', sourcePort: 'no' },
    { id: 'b-reminded-no', source: 'reminded', target: 'remind', sourcePort: 'no' },
    { id: 'b-remind', source: 'remind', target: 'sent' },
    { id: 'b-sent-no', source: 'sent', target: 'team', sourcePort: 'no' },
  ],
};

/** The map round a body: the trigger, the loop frame with its two exits, and what follows each way out. */
export const payLoop = (body: Body): { readonly nodes: ReadonlyArray<G.FlowGraphNode>; readonly edges: ReadonlyArray<G.FlowGraphEdge> } => ({
  nodes: [
    { id: 'order', kind: 'event', label: 'Order created' },
    {
      id: 'loop',
      kind: 'action',
      label: 'Wait for payment',
      container: {
        kind: 'loop',
        label: 'Wait for payment',
        description: 'up to 6 rounds',
        note: 'Not out yet: back to the first step',
        exits: [{ id: 'paid', label: 'Leave when the order is paid' }, { id: 'exhausted', label: '6 rounds without payment' }],
        childIds: body.nodes.map((node) => node.id),
      },
    },
    ...body.nodes,
    step('thanks', 'Thank the customer'),
    step('drop', 'Cancel the order'),
    { id: 'done', kind: 'end', label: 'Done' },
  ],
  edges: [
    { id: 'x-order', source: 'order', target: 'loop' },
    ...body.edges,
    { id: 'x-paid', source: 'loop', target: 'thanks', sourcePort: 'paid' },
    { id: 'x-exhausted', source: 'loop', target: 'drop', sourcePort: 'exhausted' },
    { id: 'x-thanks', source: 'thanks', target: 'done' },
    { id: 'x-drop', source: 'drop', target: 'done' },
  ],
});

/** One decision with two branches, and a timed-out wait whose road is the dashed fallback. */
export const decisionGraph: { readonly nodes: ReadonlyArray<G.FlowGraphNode>; readonly edges: ReadonlyArray<G.FlowGraphEdge> } = {
  nodes: [
    { id: 'credit', kind: 'event', label: 'Money received' },
    decision('enough', 'Enough paid?'),
    step('record', 'Record the payment'),
    { id: 'hold', kind: 'wait', label: 'Wait for the rest', description: 'Up to 1 day', outputs: [{ id: 'more', label: 'Credit' }, { id: 'timeout', label: 'Timed out' }] },
    step('remind', 'Send a reminder'),
    { id: 'done', kind: 'end', label: 'Done' },
  ],
  edges: [
    { id: 'd-credit', source: 'credit', target: 'enough' },
    { id: 'd-yes', source: 'enough', target: 'record', sourcePort: 'yes' },
    { id: 'd-no', source: 'enough', target: 'hold', sourcePort: 'no' },
    { id: 'd-more', source: 'hold', target: 'record', sourcePort: 'more' },
    { id: 'd-timeout', source: 'hold', target: 'remind', sourcePort: 'timeout', isFallback: true },
    { id: 'd-record', source: 'record', target: 'done' },
  ],
};

/** The legend of such a map: the kinds it draws, the condition as a diamond, and the loop frame. */
export const decisionLegend: ReadonlyArray<G.FlowGraphLegendItem> = [
  { kind: 'event', label: 'Event' },
  { kind: 'action', label: 'Step' },
  { kind: 'condition', label: 'Condition', shape: 'diamond' },
  { kind: 'wait', label: 'Wait' },
  { kind: 'loop', label: 'Loop' },
  { kind: 'end', label: 'End' },
];
