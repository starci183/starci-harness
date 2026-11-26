import type { Meta, StoryObj } from '@storybook/react-vite';
import * as G from '../common/index.js';

/**
 * LABEL / SUBLABEL HIERARCHY (0.37.7, LABEL-SUBLABEL-HIERARCHY). One Label per section (14 / 500, 12px above its content); the groups nested in it are named by a Sublabel
 * (12 / 500 muted, 8px above its group), never by a second Label; sibling groups stand 8px apart (only top-level Label sections stand 24 apart). `sublabel` and `title` / `label` are never given together (the types refuse it).
 */
const meta: Meta = { title: 'Surfaces/Label hierarchy' };
export default meta;
type Story = StoryObj;

const AUTO: readonly G.ChoiceOption[] = [
  { value: 'reply', label: 'Reply to messages', description: 'The assistant replies to customers right away.' },
  { value: 'tag', label: 'Tag customers' },
];
const ASK: readonly G.ChoiceOption[] = [
  { value: 'refund', label: 'Refund', description: 'Waits for your approval first.' },
  { value: 'price', label: 'Change price' },
];

export const AgentUnderstands: Story = {
  render: () => (
    <div style={{ width: 460 }}>
      <G.Section title="What the assistant knows about your work">
        <G.Section sublabel="Allowed to do alone"><G.CheckboxGroup label="Allowed to do alone" isLabelHidden options={AUTO} defaultValue={['reply']} /></G.Section>
        <G.Section sublabel="Must ask you"><G.CheckboxGroup label="Must ask you" isLabelHidden options={ASK} /></G.Section>
      </G.Section>
    </div>
  ),
};

/** A section group made with `Section sublabel` (a list with its Sublabel 8px above it), under a labelled section of the same hierarchy. */
export const SectionSublabel: Story = {
  render: () => (
    <div style={{ width: 460 }}>
      <G.Section title="Assistant permissions">
        <G.Section sublabel="Read" kind="list" items={[{ id: 'a', title: 'Orders' }]} empty={<G.EmptyNotice message="Empty" />} />
        <G.Section sublabel="Write" kind="list" items={[{ id: 'b', title: 'Notes' }]} empty={<G.EmptyNotice message="Empty" />} />
      </G.Section>
    </div>
  ),
};
