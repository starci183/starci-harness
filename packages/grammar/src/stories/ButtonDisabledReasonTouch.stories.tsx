import type { Meta, StoryObj } from '@storybook/react-vite';
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
};
