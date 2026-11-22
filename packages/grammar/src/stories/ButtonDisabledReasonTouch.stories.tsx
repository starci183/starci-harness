import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * A disabled Button's reason where no pointer can hover (0.43.1). A tooltip opens on hover and keyboard focus, so on a touch phone the reason
 * was never seen. Where `(hover: none)` or `(pointer: coarse)` matches, the one description element is drawn as a muted helper line under the
 * button (the field-description style); elsewhere it stays out of sight and the tooltip shows it. In both modes the button and its trigger
 * point at that one element, so a screen reader hears the reason once. Open the story with touch emulation (a phone device in the browser's
 * device toolbar, or Playwright's `hasTouch` with `isMobile`) to see the line.
 */
const meta: Meta = {
  title: 'Controls/Button disabled reason on touch (0.43.1)',
};
export default meta;
type Story = StoryObj;

const noop = () => undefined;
const REASON = 'Pick a plan first.';
const LONG_REASON = 'Add a payment method and accept the terms of service before you can upgrade this workspace to the Team plan.';

const touchQuery = '(hover: none), (pointer: coarse)';

/** One check of the contract, in whichever mode the page runs: one description element, both references to it, shown only on touch. */
const expectReason = (canvasElement: HTMLElement, text: string) => {
  const button = [...canvasElement.querySelectorAll<HTMLElement>('[data-component="Button"]')].find((node) => node.getAttribute('aria-describedby') !== null && document.getElementById(node.getAttribute('aria-describedby') ?? '')?.textContent === text);
  if (button === undefined) throw new Error(`a disabled Button describes itself with "${text}"`);
  const id = button.getAttribute('aria-describedby') ?? '';
  const trigger = button.closest<HTMLElement>('.starci-core-tooltip-disabled-trigger');
  if (trigger === null) throw new Error('the disabled Button stands in its tooltip trigger');
  expect(trigger.getAttribute('aria-describedby')).toBe(id);
  const described = [...canvasElement.querySelectorAll(`[id="${CSS.escape(id)}"]`)];
  expect(described).toHaveLength(1);
  const line = described[0] as HTMLElement;
  expect(line.getAttribute('aria-hidden')).toBe('true');
  if (window.matchMedia(touchQuery).matches) {
    expect(getComputedStyle(line).display).toBe('block');
    const lineBox = line.getBoundingClientRect();
    const buttonBox = button.getBoundingClientRect();
    expect(lineBox.top).toBeGreaterThanOrEqual(buttonBox.bottom);
    expect(Math.round(lineBox.left)).toBe(Math.round(buttonBox.left));
    expect(lineBox.right).toBeLessThanOrEqual(canvasElement.getBoundingClientRect().right + 0.5);
  } else {
    expect(getComputedStyle(line).display).toBe('none');
  }
  return { button, line };
};

/** A form's commit, disabled with its reason, beside its way out; then a long reason and a fill-width submit. */
export const Reasons: Story = {
  render: () => (
    <G.Stack gap="section">
      <G.Cluster gap="inline">
        <G.Button variant="border" onPress={noop}>Back</G.Button>
        <G.Button variant="primary" isDisabled disabledReason={REASON} onPress={noop}>Continue</G.Button>
      </G.Cluster>
      <G.Button variant="border" isDisabled disabledReason={LONG_REASON} onPress={noop}>Upgrade workspace</G.Button>
      <G.Button variant="primary" width="fill" type="submit" isDisabled disabledReason={REASON} onPress={noop}>Create account</G.Button>
    </G.Stack>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const { button: commit } = expectReason(canvasElement, REASON);
      // The way out keeps its top edge beside the commit: the line hangs under its own button.
      const back = [...canvasElement.querySelectorAll<HTMLElement>('[data-component="Button"]')].find((node) => node.textContent === 'Back');
      if (back === undefined) throw new Error('the way out renders');
      expect(Math.round(back.getBoundingClientRect().top)).toBe(Math.round(commit.getBoundingClientRect().top));
      const { line } = expectReason(canvasElement, LONG_REASON);
      if (window.matchMedia(touchQuery).matches) expect(getComputedStyle(line).color).not.toBe(getComputedStyle(canvasElement).color);
      const fill = [...canvasElement.querySelectorAll<HTMLElement>('[data-component="Button"][data-width="fill"]')][0];
      const trigger = fill?.closest<HTMLElement>('.starci-core-tooltip-disabled-trigger');
      if (fill === undefined || trigger == null) throw new Error('the fill submit renders');
      expect(Math.round(fill.getBoundingClientRect().width)).toBe(Math.round(trigger.getBoundingClientRect().width));
    });
  },
};
