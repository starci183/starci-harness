import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import * as G from '../common/index.js';

/** Page tabs in fold mode (`overflowLabel`): the strip folds what does not fit into a "More" menu instead of scrolling, the underline stays under its label. */
const meta: Meta = { title: 'Surfaces/Page tabs fold' };
export default meta;
type Story = StoryObj;

const WIDE = 'min(100%, 1440px)';
const PHONE = 358; // a 390px phone less its 16px page inset on each side

const views: ReadonlyArray<G.TabItem> = [
  { id: 'overview', label: 'Overview' },
  { id: 'conversations', label: 'Conversations' },
  { id: 'knowledge', label: 'Knowledge base' },
  { id: 'automations', label: 'Automations' },
  { id: 'channels', label: 'Channels' },
  { id: 'settings', label: 'Settings' },
];

const FoldPage = ({ initial }: { readonly initial: string }) => {
  const [tab, setTab] = useState(initial);
  return (
    <div data-story-fold="true">
      <G.Page
        header={{
          title: 'Support agent',
          tabs: { label: 'Agent views', selectedKey: tab, onSelect: setTab, items: views, overflowLabel: 'More', moreLabel: (count) => `${count} more views` },
        }}
      >
        <G.Text>{views.find((item) => item.id === tab)?.label} body</G.Text>
      </G.Page>
    </div>
  );
};

/** The underline's top is at or below the label's bottom, its bottom on the line; when the strip folds, the selected tab stays in the strip and the menu trigger is drawn. */
const foldStory = (width: string | number, initial: string): Story => ({
  render: () => <div style={{ width }}><FoldPage initial={initial} /></div>,
});

/** At 1440 the six views fit: no menu, the underline under "Overview". */
export const PageTabsFold1440: Story = foldStory(WIDE, 'overview');
/** At 390 the strip folds the tail into "More"; the selected tab stays shown with its underline under it. */
export const PageTabsFold390: Story = foldStory(PHONE, 'overview');
/** At 390 with the last view selected: it stays in the strip and the underline is under it. */
export const PageTabsFold390LastSelected: Story = foldStory(PHONE, 'settings');

/* ---------- the underline follows the selected key; the active tab is in view ---------- */

const reports: ReadonlyArray<G.TabItem> = [
  { id: 'orders', label: 'Orders' },
  { id: 'customers', label: 'Customers' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'shipping', label: 'Shipping and returns' },
  { id: 'finished', label: 'Finished reports' },
];

const SelectionDemo = ({ initial, scrolling }: { readonly initial: string; readonly scrolling: boolean }) => {
  const [tab, setTab] = useState(initial);
  return (
    <div data-story-select="true">
      <G.Tabs label="Reports" selectedKey={tab} onSelect={setTab} items={reports} {...(scrolling ? {} : { overflowLabel: 'More' })} />
      <G.Button variant="border" size="sm" onPress={() => setTab('finished')}>Select the last</G.Button>
      <G.Button variant="border" size="sm" onPress={() => setTab('orders')}>Select the first</G.Button>
    </div>
  );
};

const selectionStory = (width: string | number, initial: string, scrolling: boolean, change: boolean): Story => ({
  render: () => <div style={{ width }}><SelectionDemo initial={initial} scrolling={scrolling} /></div>,
  play: async ({ canvasElement }) => {
    if (!change) return;
    const target = initial === 'finished' ? 'Select the first' : 'Select the last';
    const button = Array.from(canvasElement.querySelectorAll<HTMLElement>('button')).find((item) => item.textContent === target);
    if (button === undefined) throw new Error('the selection button renders');
    button.click();
  },
});

/** At 390 a strip that scrolls opens on the last tab: the strip scrolls it into view and the underline is under it. */
export const ScrollingOpensOnLast390: Story = selectionStory(PHONE, 'finished', true, false);
/** A programmatic change of the selected key moves the underline under the new tab and brings it into view (390, scrolling). */
export const ScrollingSelectionChange390: Story = selectionStory(PHONE, 'orders', true, true);
/** The same change in a folding strip (1440 fits, 390 folds). */
export const FoldSelectionChange390: Story = selectionStory(PHONE, 'orders', false, true);
/** Fixed 1440px boxes: the DNA run measures right after a viewport change, so a measure that follows the viewport would read the layout before the strip reacted. */
export const SelectionChange1440: Story = selectionStory(1440, 'orders', true, true);

const linkReports: ReadonlyArray<G.TabItem> = reports.map((item) => ({ ...item, href: `/agent/${item.id}` }));

/** Link tabs with no `selectedKey` (a server page's page tabs): the strip draws only once it knows the path, so the underline is never first drawn under the first tab. */
const LinkStrip = () => {
  const [ready] = useState(() => {
    window.history.replaceState(null, '', '/agent/finished');
    return true;
  });
  return ready ? <div data-story-select="true"><G.Tabs label="Reports" items={linkReports} /></div> : null;
};

const linkStory = (width: string | number): Story => ({
  render: () => <div style={{ width }}><LinkStrip /></div>,
});

export const LinkTabsOpenOnRoute1440: Story = linkStory(1440);
export const LinkTabsOpenOnRoute390: Story = linkStory(PHONE);
