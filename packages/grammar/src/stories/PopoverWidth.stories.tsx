import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import { BellGlyph, noop } from './fixtures.js';

/**
 * THE POPOVER WIDTH (0.45.1). A `Popover` is 26rem wide, or the viewport less 2rem, so a panel of rows (a leading mark, the
 * copy, an action) never collapses to one word per line and no app sets a width. A short note stands in the same panel.
 */
const meta: Meta = { title: 'Overlays/Popover width (0.45.1)', parameters: { grammar: { minHeight: '46rem' } } };
export default meta;
type Story = StoryObj;

const NOTICES: readonly G.SectionRow[] = [
  { id: 'n1', title: 'Sales assistant waits for you to approve a quote of 8,640,000 VND for Thu Trang', description: 'Open the card in Office, 2 h 58 min left', leading: { icon: BellGlyph }, meta: { text: '3 min' }, action: { label: 'Approve', press: noop }, actionPlacement: 'end', edgeTone: 'warning' },
  { id: 'n2', title: 'Zalo OA lost its connection', description: 'Open Connections, 5 retries failed', leading: { icon: BellGlyph }, meta: { text: '09:12' }, action: { label: 'Reconnect', press: noop }, actionPlacement: 'end', edgeTone: 'danger' },
  { id: 'n3', title: 'Overdue: call back Mai Phuong', description: 'Minh Tran is responsible, 1 day late', leading: { icon: BellGlyph }, meta: { text: 'Yesterday' } },
];

const panelWidth = (canvasElement: HTMLElement) => {
  const panel = canvasElement.ownerDocument.querySelector<HTMLElement>('.starci-core-popover');
  if (panel === null) throw new Error('The popover must be open');
  return panel.getBoundingClientRect().width;
};

/** A notification panel: rows with a mark, copy and an action. It opens 26rem wide (the viewport less 2rem at 390), never as a column of single words. */
export const Panel: Story = {
  render: () => (
    <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '1rem' }}>
      <G.Popover defaultOpen placement="bottom" title="Notifications" trigger={<G.IconButton label="Notifications" source={BellGlyph} variant="border" />}>
        <G.Section kind="list" ariaLabel="Notifications" items={NOTICES} empty={<G.EmptyNotice message="Nothing new." />} />
      </G.Popover>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const width = panelWidth(canvasElement);
      const viewport = canvasElement.ownerDocument.documentElement.clientWidth;
      // At 480px and narrower the panel is the full-width sheet (0.48.0).
      expect(Math.abs(width - (viewport <= 480 ? viewport : Math.min(26 * 16, viewport - 32)))).toBeLessThan(2);
      const name = canvasElement.ownerDocument.querySelector<HTMLElement>('.starci-core-popover .starci-core-list-row-name');
      expect(name?.getBoundingClientRect().width ?? 0).toBeGreaterThan(140);
    }, { timeout: 4000 });
  },
};

/** A short note stands in the same 26rem panel, not a sliver. */
export const Short: Story = {
  render: () => (
    <div style={{ paddingTop: '1rem' }}>
      <G.Popover defaultOpen label="Shortcut" trigger={<G.Button variant="border">Shortcut</G.Button>}>
        <G.Text role="body">Press Ctrl K to search.</G.Text>
      </G.Popover>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const viewport = canvasElement.ownerDocument.documentElement.clientWidth;
      expect(Math.abs(panelWidth(canvasElement) - (viewport <= 480 ? viewport : Math.min(26 * 16, viewport - 32)))).toBeLessThan(2);
    }, { timeout: 4000 });
  },
};

/**
 * THE POPOVER SIZE (0.46.2). `size` is `sm` (18rem), `md` (26rem, the default) or `lg` (36rem), each capped at the viewport less 2rem: on a phone all three are the same
 * full-width panel. A panel is never as narrow as its trigger.
 */
export const Sizes: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '1rem', paddingTop: '1rem', flexWrap: 'wrap' }}>
      {(['sm', 'md', 'lg'] as const).map((size) => (
        <G.Popover key={size} size={size} label={`Size ${size}`} trigger={<G.IconButton label={`Open ${size}`} source={BellGlyph} variant="border" />}>
          <G.Text role="body">{`Panel of size ${size}`}</G.Text>
        </G.Popover>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const document = canvasElement.ownerDocument;
    const viewport = document.documentElement.clientWidth;
    const widths: Record<string, number> = {};
    for (const size of ['sm', 'md', 'lg']) {
      const trigger = [...canvasElement.querySelectorAll<HTMLElement>('button')].find((button) => button.getAttribute('aria-label') === `Open ${size}`);
      if (trigger === undefined) throw new Error(`no trigger for ${size}`);
      trigger.click();
      await waitFor(() => {
        const panel = document.querySelector<HTMLElement>(`.starci-core-popover[data-size="${size}"]`);
        if (panel === null) throw new Error('The popover must be open');
        widths[size] = panel.getBoundingClientRect().width;
      }, { timeout: 4000 });
      trigger.click();
      await waitFor(() => { expect(document.querySelector('.starci-core-popover')).toBeNull(); }, { timeout: 4000 });
    }
    for (const [size, rem] of [['sm', 18], ['md', 26], ['lg', 36]] as const) {
      expect(Math.abs((widths[size] ?? 0) - (viewport <= 480 ? viewport : Math.min(rem * 16, viewport - 32)))).toBeLessThan(2);
    }
  },
};
