import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * A labelled Switch is ONE row (0.37.5, owner): the label (14, weight 500) and the description (12, muted) at the start filling the row, the control at the end edge,
 * centred vertically, the whole row the hit target. A switch with a hidden label is the bare control.
 */
const meta: Meta = { title: 'Controls/Switch row' };
export default meta;
type Story = StoryObj;

const PHONE = { viewport: { value: 'phone375', isRotated: false } };

/** The rendered track of the first Switch of a kind, in CSS px (a rem track is 16px per rem at the story root). */
const trackOf = (root: HTMLElement, kind: 'toggle' | 'compact', labelled: 'true' | 'false'): { track: DOMRect; thumb: DOMRect } => {
  const switchEl = root.querySelector<HTMLElement>(`[data-component="Switch"][data-grammar-switch-kind="${kind}"][data-grammar-switch-labelled="${labelled}"]`);
  if (switchEl === null) throw new Error(`a ${labelled === 'true' ? 'labelled' : 'bare'} ${kind} switch renders`);
  return {
    track: switchEl.querySelector<HTMLElement>('[data-grammar-switch-track="true"]')!.getBoundingClientRect(),
    thumb: switchEl.querySelector<HTMLElement>('[data-grammar-switch-thumb="true"]')!.getBoundingClientRect(),
  };
};

const sizesRender = () => (
  <div style={{ width: 420 }}>
    <G.Switch label="Show the waiting count" description="Shows how many turns are waiting." />
    <G.Switch label="Compact, on" description="An explicit compact switch." kind="compact" defaultSelected />
    <G.Switch label="Dark theme" isLabelHidden />
    <G.Switch label="Dark theme, toggle" isLabelHidden kind="toggle" defaultSelected />
    <G.Switch label="Compact bare" isLabelHidden kind="compact" />
  </div>
);

const assertSizes = async (canvasElement: HTMLElement) => {
  await waitFor(() => {
    const toggle = trackOf(canvasElement, 'toggle', 'false');
    expect(Math.round(toggle.track.width)).toBe(72);
    expect(Math.round(toggle.track.height)).toBe(40);
    expect(Math.round(toggle.thumb.width)).toBe(32);
    const compact = trackOf(canvasElement, 'compact', 'false');
    expect(Math.round(compact.track.width)).toBe(32);
    expect(Math.round(compact.track.height)).toBe(18);
    expect(Math.round(compact.thumb.width)).toBe(14);
    expect(Math.round(compact.thumb.left - compact.track.left)).toBe(2);
    expect(canvasElement.querySelector('[data-grammar-switch-kind="compact"] .starci-core-switch-icon')).toBeNull();
  });
};

/** The two kinds side by side: `toggle` 72x40 (thumb 32), `compact` 32x18 (thumb 14, inset 2). A labelled switch with no kind is the toggle (the default is unchanged). */
export const TwoKinds: Story = { render: sizesRender, play: async ({ canvasElement }) => { await assertSizes(canvasElement); } };
export const TwoKindsAt390: Story = { parameters: PHONE, render: sizesRender, play: async ({ canvasElement }) => { await assertSizes(canvasElement); } };

const settingsRender = () => (
  <div style={{ width: 360 }}>
    <G.Switch label="Show the waiting count" description="Shows how many turns are waiting." kind="compact" />
    <G.Switch label="Auto reply" description="The assistant replies right away." kind="compact" defaultSelected />
    <G.Switch label="Locked" description="Disabled at 45%." kind="compact" isDisabled />
  </div>
);

const assertSettings = async (canvasElement: HTMLElement) => {
  await waitFor(() => {
    const { track } = trackOf(canvasElement, 'compact', 'true');
    expect(Math.round(track.width)).toBe(32);
    expect(Math.round(track.height)).toBe(18);
    const disabled = canvasElement.querySelector<HTMLElement>('[data-component="Switch"][data-disabled="true"]')!;
    expect(getComputedStyle(disabled).opacity).toBe('0.45');
  });
};

/** A settings row: the compact switch at the end of a labelled row, the whole row the hit target. */
export const CompactSettingsRows: Story = { render: settingsRender, play: async ({ canvasElement }) => { await assertSettings(canvasElement); } };
export const CompactSettingsRowsAt390: Story = { parameters: PHONE, render: settingsRender, play: async ({ canvasElement }) => { await assertSettings(canvasElement); } };

export const LabelledRow: Story = {
  render: () => (
    <div style={{ width: 420 }}>
      <G.Switch label="Auto reply" description="The assistant replies to customers right away, you review later." kind="compact" defaultSelected />
      <G.Switch description="Short description." label="Label only" kind="compact" />
      <G.Switch label="Dark theme" isLabelHidden />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const [row] = Array.from(canvasElement.querySelectorAll<HTMLElement>('[data-component="Switch"][data-grammar-switch-labelled="true"]'));
      if (row === undefined) throw new Error('the labelled switch renders');
      const box = row.getBoundingClientRect();
      const text = row.querySelector<HTMLElement>('.starci-core-switch-text')!.getBoundingClientRect();
      const control = row.querySelector<HTMLElement>('[data-grammar-switch-track="true"]')!.getBoundingClientRect();
      expect(text.left).toBeLessThan(control.left);
      expect(Math.abs(control.right - box.right)).toBeLessThanOrEqual(1);
      expect(Math.abs((control.top + control.bottom) / 2 - (box.top + box.bottom) / 2)).toBeLessThanOrEqual(2);
    });
  },
};

/** The sRGB channels (0..255) a computed CSS colour paints, read back through a 1px canvas so any colour syntax (oklab, color-mix) resolves. */
const paintedRgb = (color: string): readonly [number, number, number] => {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d')!;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
};

/** WCAG relative luminance of an sRGB colour. */
const luminance = ([r, g, b]: readonly [number, number, number]): number => {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
};

const offTrackRender = () => (
  <div style={{ width: 360, padding: 16, background: '#fff' }}>
    <G.Switch label="Auto reply" description="The assistant replies right away." kind="compact" />
    <G.Switch label="Show the waiting count" description="Shows how many turns are waiting." kind="compact" defaultSelected />
    <G.Switch label="Dark theme" isLabelHidden />
  </div>
);

/**
 * The off track on white (0.44.0): the default fill is the foreground at 28% over the surface, a light grey (between neutral-300 and neutral-400)
 * that reads on #fff with no app token, on both kinds. A switch has no border by default; the hairline is the opt-in
 * `--starci-core-switch-track-off-border`.
 */
const assertOffTrack = async (canvasElement: HTMLElement) => {
  await waitFor(() => {
    for (const kind of ['compact', 'toggle'] as const) {
      const switchEl = canvasElement.querySelector<HTMLElement>(`[data-component="Switch"][data-grammar-switch-kind="${kind}"]:not([data-selected="true"])`);
      if (switchEl === null) throw new Error(`an off ${kind} switch renders`);
      const track = switchEl.querySelector<HTMLElement>('[data-grammar-switch-track="true"]')!;
      const style = getComputedStyle(track);
      const fill = luminance(paintedRgb(style.backgroundColor));
      expect(fill).toBeLessThan(0.55);
      expect(fill).toBeGreaterThan(0.35);
      expect(style.outlineStyle === 'none' || style.outlineWidth === '0px').toBe(true);
      expect(style.borderTopWidth).toBe('0px');
    }
  });
};

export const OffTrackOnWhite: Story = { render: offTrackRender, play: async ({ canvasElement }) => { await assertOffTrack(canvasElement); } };
export const OffTrackOnWhiteAt390: Story = { parameters: PHONE, render: offTrackRender, play: async ({ canvasElement }) => { await assertOffTrack(canvasElement); } };
