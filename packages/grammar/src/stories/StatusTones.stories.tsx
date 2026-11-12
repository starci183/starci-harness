import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * The status tones side by side (0.37.5, owner: "success phải để màu success"). A success Badge and StatusDot read the HeroUI `success` tokens exactly
 * (`--success-soft` and `--success-soft-foreground` for the chip, `--success` for the dot): Core maps `success` to nothing else. A product that paints
 * them lime has overridden `--success` in its own brand sheet; the play compares the chip's ink and tint with the tokens.
 */
const meta: Meta = { title: 'Surfaces/Status tones' };
export default meta;
type Story = StoryObj;

const TONES = ['neutral', 'accent', 'success', 'warning', 'danger'] as const;

export const SideBySide: Story = {
  render: () => (
    <G.Stack gap="section">
      <G.Cluster gap="row">
        {TONES.map((tone) => (
          <G.Badge key={tone} tone={tone}>{tone}</G.Badge>
        ))}
      </G.Cluster>
      <G.Cluster gap="row">
        {TONES.map((tone) => (
          <G.StatusDot key={tone} tone={tone} aria-label={tone} />
        ))}
      </G.Cluster>
    </G.Stack>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const badge = canvasElement.querySelector<HTMLElement>('[data-component="Badge"][data-tone="success"]');
      if (badge === null) throw new Error('the success badge renders');
      const probe = document.createElement('span');
      probe.style.color = 'var(--success-soft-foreground)';
      probe.style.backgroundColor = 'var(--success-soft)';
      canvasElement.append(probe);
      const want = getComputedStyle(probe);
      const got = getComputedStyle(badge);
      expect(got.color).toBe(want.color);
      expect(got.backgroundColor).toBe(want.backgroundColor);
      probe.remove();
    });
  },
};
