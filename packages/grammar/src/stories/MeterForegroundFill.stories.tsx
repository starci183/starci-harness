import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * A measure that spends no accent: `Meter tone="foreground"` and `Progress tone="foreground"` fill with HeroUI's `--foreground` text
 * colour on the default track, so a usage quota stands beside a screen's one commit without a second red mass (ACCENT-6).
 * `tone="neutral"` keeps the accent fill (ACCENT-4); the role and the `aria-value*` of both are unchanged.
 */
const meta: Meta = { title: 'Meter foreground fill (0.37.38)', parameters: { grammar: { bleed: false } } };
export default meta;
type Story = StoryObj;

/** The resolved `--foreground` of the root, painted on a probe so it compares as a computed colour. */
const foregroundOf = (canvasElement: HTMLElement) => {
  const probe = document.createElement('span');
  probe.style.backgroundColor = 'var(--foreground)';
  canvasElement.appendChild(probe);
  const colour = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return colour;
};

const fillsAreForeground = (canvasElement: HTMLElement) => {
  const foreground = foregroundOf(canvasElement);
  const meters = Array.from(canvasElement.querySelectorAll<HTMLElement>('[data-component="Meter"][data-grammar-tone="foreground"]'));
  expect(meters.length).toBe(4);
  for (const meter of meters) {
    expect(meter.getAttribute('role')).toBe('meter');
    expect(meter.getAttribute('aria-valuenow')).not.toBeNull();
    const fill = meter.querySelector<HTMLElement>('[data-slot="meter-fill"], [data-grammar-meter-segment="filled"]')!;
    expect(getComputedStyle(fill).backgroundColor).toBe(foreground);
  }
  const bar = canvasElement.querySelector<HTMLElement>('[data-component="Progress"][data-grammar-progress-tone="foreground"]')!;
  expect(bar.getAttribute('role')).toBe('progressbar');
  expect(getComputedStyle(bar.querySelector<HTMLElement>('[data-slot="progress-bar-fill"]')!).backgroundColor).toBe(foreground);
  const neutral = canvasElement.querySelector<HTMLElement>('[data-component="Meter"][data-grammar-tone="neutral"] [data-slot="meter-fill"]')!;
  expect(getComputedStyle(neutral).backgroundColor).not.toBe(foreground);
};

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
  play: async ({ canvasElement }) => { await waitFor(() => fillsAreForeground(canvasElement)); },
};

export const Dark: Story = {
  name: 'Foreground fill at 40, 92 and 100 % (dark)',
  globals: { grammarTheme: 'dark' },
  render,
  play: async ({ canvasElement }) => { await waitFor(() => fillsAreForeground(canvasElement)); },
};
