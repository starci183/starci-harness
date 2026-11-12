import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import { noop } from './fixtures.js';

/**
 * MESSAGE-CARD-FILL and BUTTON-WRAP (0.37.30, the /chat stop card). A MessageCard's content column fills the card: a nested bordered
 * list (surface in surface: `SurfaceCard kind="list"`) and a composer in its body span the card's inner width, while the head, the
 * actions row and the meta line still start at the reading edge. A suggestion pill (`Button size="sm"`) with `width="wrap"` hugs a
 * short label like `content` and wraps a label longer than its container inside the pill (same radius and inline padding, text at
 * the reading edge), growing from the 32px step; it never spills out of its row.
 */
const meta: Meta = { title: 'Navigation & Data/Message card fill (0.37.30)', parameters: { grammar: { bleed: false } } };
export default meta;
type Story = StoryObj;

const facts: readonly G.ListRowData[] = [
  { id: 'workflow', title: 'Workflow', value: 'Close the order by chat' },
  { id: 'step', title: 'Step', value: 'Send the payment QR' },
  { id: 'reason', title: 'Reason', value: 'Customer asked about delivery outside the area' },
];

const suggestions = [
  'Agree',
  'Ask for the address again',
  'Tell the customer the out-of-area delivery fee is $30 and ask whether they want to continue with this order, and if so send the payment QR again',
] as const;

const Suggestions = () => (
  <G.Cluster gap="inline" label="Suggested replies">
    {suggestions.map((text) => (
      <G.Button key={text} intent="neutral" size="sm" width="wrap" onPress={noop}>
        {text}
      </G.Button>
    ))}
  </G.Cluster>
);

const Composer = () => (
  <G.Cluster gap="inline" align="end" wrap={false}>
    <div style={{ flex: 1, minWidth: 0 }}>
      <G.Textarea label="Reply" isLabelHidden placeholder="Reply to the assistant..." />
    </div>
    <G.Button intent="commit" startGlyph="send" onPress={noop}>
      Send
    </G.Button>
  </G.Cluster>
);

const stopBody = (
  <G.Stack gap="row">
    <G.SurfaceCard kind="list" layout="keyValue" ariaLabel="Details" empty={null} items={facts} />
    <Suggestions />
    <Composer />
  </G.Stack>
);

/** The stop card: the bordered list, the suggestions and the composer fill the card's inner width; the head, actions and meta start at the reading edge. */
export const NestedListAndComposer: Story = {
  render: () => (
    <div style={{ maxWidth: '64rem' }}>
      <G.MessageCard
        measure="wide"
        author="Assistant"
        avatar={<G.Avatar name="Assistant" size="sm" />}
        title="Workflow paused"
        chip={<G.Badge tone="warning">Needs your decision</G.Badge>}
        body={stopBody}
        actions={[
          { id: 'retry', label: 'Retry', onPress: noop },
          { id: 'take', label: 'Take over', onPress: noop },
          { id: 'skip', label: 'Skip', onPress: noop },
        ]}
        meta="Close the order by chat · Send QR · 09:12 · attempt 2"
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('[data-component="MessageCard"]')).not.toBeNull());
    const card = canvasElement.querySelector<HTMLElement>('[data-component="MessageCard"]')!;
    const list = card.querySelector<HTMLElement>('[data-component="SurfaceCard"]')!;
    const textarea = card.querySelector<HTMLElement>('textarea')!;
    const send = [...card.querySelectorAll<HTMLElement>('[data-component="Button"]')].find((b) => b.textContent?.includes('Send'))!;
    const box = card.getBoundingClientRect();
    expect(Math.abs(list.getBoundingClientRect().width - box.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(send.getBoundingClientRect().right - box.right)).toBeLessThanOrEqual(1);
    expect(textarea.getBoundingClientRect().left - box.left).toBeLessThanOrEqual(1);
  },
};

/** Long suggestion pills in a narrow container: the short ones hug their label at 32px; the long one wraps inside its pill and stays within the column. */
export const LongSuggestionsNarrow: Story = {
  render: () => (
    <div style={{ inlineSize: '18rem' }} data-testid="narrow">
      <Suggestions />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const column = canvasElement.querySelector<HTMLElement>('[data-testid="narrow"]')!;
    await waitFor(() => expect(column.querySelectorAll('[data-component="Button"]').length).toBe(3));
    const right = column.getBoundingClientRect().right;
    const pills = [...column.querySelectorAll<HTMLElement>('[data-component="Button"]')];
    for (const pill of pills) expect(pill.getBoundingClientRect().right).toBeLessThanOrEqual(right + 0.5);
    expect(Math.round(pills[0]!.getBoundingClientRect().height)).toBe(32);
    expect(pills[2]!.getBoundingClientRect().height).toBeGreaterThan(32);
  },
};
