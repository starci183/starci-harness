import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * LABEL / SUBLABEL HIERARCHY (0.37.7, LABEL-SUBLABEL-HIERARCHY). One Label per section (14 / 500, 12px above its content); the groups nested in it are named by a Sublabel
 * (12 / 500 muted, 8px above the card), never by a second Label; sibling groups stand 8px apart, like their Sublabel to its card (only top-level Label sections stand 24 apart). `sublabel` and `title` / `label` are never given together (the types refuse it).
 */
const meta: Meta = { title: 'Surfaces/Label hierarchy' };
export default meta;
type Story = StoryObj;

const AUTO = [
  { id: 'reply', title: 'Reply to messages', subtitle: 'The assistant replies to customers right away.' },
  { id: 'tag', title: 'Tag customers' },
];
const ASK = [
  { id: 'refund', title: 'Refund', subtitle: 'Waits for your approval first.' },
  { id: 'price', title: 'Change price' },
];

export const AgentUnderstands: Story = {
  render: () => (
    <div style={{ width: 460 }}>
      <G.Section title="What the assistant knows about your work">
        <G.SurfaceCard kind="select" sublabel="Allowed to do alone" selectionMode="multiple" items={AUTO} value={['reply']} onChange={() => undefined} />
        <G.SurfaceCard kind="select" sublabel="Must ask you" selectionMode="multiple" items={ASK} value={[]} onChange={() => undefined} />
      </G.Section>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const section = canvasElement.querySelector<HTMLElement>('section.starci-core-section')!;
      const title = section.querySelector<HTMLElement>('.starci-core-section-title')!;
      const sublabels = Array.from(section.querySelectorAll<HTMLElement>('.starci-core-sublabel'));
      expect(sublabels.length).toBe(2);
      const label = getComputedStyle(title);
      expect(label.fontSize).toBe('14px');
      expect(label.fontWeight).toBe('500');
      const small = getComputedStyle(sublabels[0]!);
      expect(small.fontSize).toBe('12px');
      expect(small.fontWeight).toBe('500');
      const head = section.querySelector<HTMLElement>('.starci-core-section-header')!.getBoundingClientRect();
      const cards = Array.from(section.querySelectorAll<HTMLElement>('.starci-core-surface-card'));
      // Label -> first group: 12px (the section's row gap).
      expect(Math.round(cards[0]!.getBoundingClientRect().top - head.bottom)).toBe(12);
      // Sublabel -> its card: 8px.
      const first = sublabels[0]!.getBoundingClientRect();
      const surface = cards[0]!.querySelector<HTMLElement>('.starci-core-surface')!.getBoundingClientRect();
      expect(Math.round(surface.top - first.bottom)).toBe(8);
      // Group -> group: 8px (they belong to the Label above).
      expect(Math.round(cards[1]!.getBoundingClientRect().top - cards[0]!.getBoundingClientRect().bottom)).toBe(8);
    });
  },
};

/** A section group made with `Section sublabel` (a list with its Sublabel 8px above it), under a labelled card of the same hierarchy. */
export const SectionSublabel: Story = {
  render: () => (
    <div style={{ width: 460 }}>
      <G.Section title="Assistant permissions">
        <G.Section sublabel="Read" kind="list" items={[{ id: 'a', title: 'Orders' }]} empty={<G.EmptyNotice message="Empty" />} />
        <G.Section sublabel="Write" kind="list" items={[{ id: 'b', title: 'Notes' }]} empty={<G.EmptyNotice message="Empty" />} />
      </G.Section>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const groups = Array.from(canvasElement.querySelectorAll<HTMLElement>('section[data-grammar-section-sublabel="true"]'));
      expect(groups.length).toBe(2);
      expect(Math.round(groups[1]!.getBoundingClientRect().top - groups[0]!.getBoundingClientRect().bottom)).toBe(8);
      const sub = groups[0]!.querySelector<HTMLElement>('.starci-core-sublabel')!.getBoundingClientRect();
      const body = groups[0]!.querySelector<HTMLElement>('.starci-core-section-list')!.getBoundingClientRect();
      expect(Math.round(body.top - sub.bottom)).toBe(8);
    });
  },
};
