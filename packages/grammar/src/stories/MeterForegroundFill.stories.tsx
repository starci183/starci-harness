import type { Meta, StoryObj } from '@storybook/react-vite';
import * as G from '../common/index.js';

/**
 * A measure that spends no accent: `Meter tone="foreground"` and `Progress tone="foreground"` fill with HeroUI's `--foreground` text
 * colour on the default track, so a usage quota stands beside a screen's one commit without a second red mass (ACCENT-6).
 * `tone="neutral"` keeps the accent fill (ACCENT-4); the role and the `aria-value*` of both are unchanged.
 */
const meta: Meta = { title: 'Meter foreground fill (0.37.38)', parameters: { grammar: { bleed: false } } };
export default meta;
type Story = StoryObj;

const render = () => (
  <div style={{ display: 'grid', gap: 'var(--grammar-section-gap)', maxInlineSize: 420 }}>
    <G.Meter label="Documents" value={40} valueLabel="20 of 50 MB" tone="foreground" />
    <G.Meter label="Documents" value={92} valueLabel="46 of 50 MB" tone="foreground" />
    <G.Meter label="Documents" value={100} valueLabel="50 of 50 MB" tone="foreground" />
    <G.Meter label="Capabilities" value={2} maxValue={3} segments={3} valueLabel="2 of 3" tone="foreground" />
    <G.Progress label="Upload" value={40} tone="foreground" />
    <G.Meter label="Documents (neutral keeps the accent)" value={40} tone="neutral" />
  </div>
);

export const Light: Story = {
  name: 'Foreground fill at 40, 92 and 100 %',
  render,
};

export const Dark: Story = {
  name: 'Foreground fill at 40, 92 and 100 % (dark)',
  globals: { grammarTheme: 'dark' },
  render,
};
