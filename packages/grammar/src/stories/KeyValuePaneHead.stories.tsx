import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { userEvent, waitFor, within } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * `Section kind="list" layout="keyValue"` draws muted keys and normal values (values wrap under the key on a narrow list); `Pane head` is a sticky one-row head with a close button.
 */
const meta: Meta = { title: 'Surfaces/Key-value rows and pane head', parameters: { layout: 'fullscreen' } };
export default meta;
type Story = StoryObj;

const FACTS = [
  { id: 'a', title: 'Customer', value: 'Maria Garcia' },
  { id: 'b', title: 'Delivery address', value: '125/7 Lakeside Boulevard, Northgate District, Springfield Heights, Greater Metropolitan Area' },
  { id: 'c', title: 'Status', value: 'Paid' },
];

export const KeyValueRows: Story = {
  render: () => (
    <div style={{ padding: 24, display: 'grid', gap: 24, gridTemplateColumns: '30rem 16rem', alignItems: 'start' }}>
      <G.Section kind="list" layout="keyValue" title="Order details" items={FACTS} empty={<G.EmptyNotice message="Empty" />} />
      <G.Section kind="list" layout="keyValue" title="Narrow" items={FACTS} empty={<G.EmptyNotice message="Empty" />} />
    </div>
  ),
};

const Head = () => {
  const [closed, setClosed] = useState(0);
  return (
    <div style={{ height: 360 }}>
      <G.PaneGrid label="Detail" areas={['main aside']} columns={['fill', 'standard']}>
        <G.Pane area="main" label="Main"><G.PaneSection><G.Text>{`closed ${closed}`}</G.Text></G.PaneSection></G.Pane>
        <G.Pane area="aside" surface scroll label="Details" head={{ title: 'Customer details', description: 'Maria Garcia', onClose: () => setClosed((n) => n + 1), closeLabel: 'Close' }}>
          <G.PaneSection>{Array.from({ length: 60 }, (_, index) => <G.Text key={index}>{`Line ${index + 1}`}</G.Text>)}</G.PaneSection>
        </G.Pane>
      </G.PaneGrid>
    </div>
  );
};

export const PaneHeadSlot: Story = {
  render: () => <Head />,
  play: async ({ canvasElement }) => {
    const aside = await waitFor(() => {
      const element = canvasElement.querySelector<HTMLElement>('[data-grammar-pane-area="aside"]');
      if (element === null) throw new Error('the aside renders');
      return element;
    });
    const scroller = aside.querySelector<HTMLElement>('.starci-core-pane-scroll') ?? aside;
    scroller.scrollTop = 300;
    await userEvent.click(within(aside).getByRole('button', { name: 'Close' }));
  },
};
