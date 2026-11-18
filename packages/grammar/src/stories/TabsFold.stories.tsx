import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, waitFor } from 'storybook/test';
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
const foldStory = (width: string | number, initial: string, folded: boolean): Story => ({
  render: () => <div style={{ width }}><FoldPage initial={initial} /></div>,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const frame = canvasElement.querySelector<HTMLElement>('[data-story-fold="true"] [data-grammar-tabs="true"][data-grammar-tabs-client="ready"]');
      if (frame === null) throw new Error('the strip renders');
      expect(frame.dataset.grammarTabsFolds).toBe('true');
      expect(frame.hasAttribute('data-grammar-tabs-measuring-fit')).toBe(false);
      const selected = frame.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      const indicator = selected?.querySelector<HTMLElement>('.tabs__indicator');
      const label = selected?.querySelector<HTMLElement>('.starci-core-tab-label');
      if (selected == null || indicator == null || label == null) throw new Error('the selected tab draws its label and its underline');
      expect(indicator.getBoundingClientRect().top).toBeGreaterThanOrEqual(label.getBoundingClientRect().bottom - 0.5);
      expect(indicator.getBoundingClientRect().bottom).toBeLessThanOrEqual(selected.getBoundingClientRect().bottom + 2.5);
      expect(frame.querySelector('.starci-core-tabs-more') !== null).toBe(folded);
    }, { timeout: 5000 });
  },
});

/** At 1440 the six views fit: no menu, the underline under "Overview". */
export const PageTabsFold1440: Story = foldStory(WIDE, 'overview', false);
/** At 390 the strip folds the tail into "More"; the selected tab stays shown with its underline under it. */
export const PageTabsFold390: Story = foldStory(PHONE, 'overview', true);
/** At 390 with the last view selected: it stays in the strip and the underline is under it. */
export const PageTabsFold390LastSelected: Story = foldStory(PHONE, 'settings', true);
