import type { Meta, StoryObj } from '@storybook/react-vite';
import * as G from '../common/index.js';

/**
 * A labelled Switch is ONE row (0.37.5, owner): the label (14, weight 500) and the description (12, muted) at the start filling the row, the control at the end edge,
 * centred vertically, the whole row the hit target. A switch with a hidden label is the bare control.
 */
const meta: Meta = { title: 'Controls/Switch row' };
export default meta;
type Story = StoryObj;

const PHONE = { viewport: { value: 'phone375', isRotated: false } };

const sizesRender = () => (
  <div style={{ width: 420 }}>
    <G.Switch label="Show the waiting count" description="Shows how many turns are waiting." />
    <G.Switch label="Compact, on" description="An explicit compact switch." kind="compact" defaultSelected />
    <G.Switch label="Dark theme" isLabelHidden />
    <G.Switch label="Dark theme, toggle" isLabelHidden kind="toggle" defaultSelected />
    <G.Switch label="Compact bare" isLabelHidden kind="compact" />
  </div>
);

/** The two kinds side by side: `toggle` 72x40 (thumb 32), `compact` 32x18 (thumb 14, inset 2). A labelled switch with no kind is the toggle (the default is unchanged). */
export const TwoKinds: Story = { render: sizesRender, };
export const TwoKindsAt390: Story = { parameters: PHONE, render: sizesRender, };

const settingsRender = () => (
  <div style={{ width: 360 }}>
    <G.Switch label="Show the waiting count" description="Shows how many turns are waiting." kind="compact" />
    <G.Switch label="Auto reply" description="The assistant replies right away." kind="compact" defaultSelected />
    <G.Switch label="Locked" description="Disabled at 45%." kind="compact" isDisabled />
  </div>
);

/** A settings row: the compact switch at the end of a labelled row, the whole row the hit target. */
export const CompactSettingsRows: Story = { render: settingsRender, };
export const CompactSettingsRowsAt390: Story = { parameters: PHONE, render: settingsRender, };

export const LabelledRow: Story = {
  render: () => (
    <div style={{ width: 420 }}>
      <G.Switch label="Auto reply" description="The assistant replies to customers right away, you review later." kind="compact" defaultSelected />
      <G.Switch description="Short description." label="Label only" kind="compact" />
      <G.Switch label="Dark theme" isLabelHidden />
    </div>
  ),
};

const offTrackRender = () => (
  <div style={{ width: 360, padding: 16, background: '#fff' }}>
    <G.Switch label="Auto reply" description="The assistant replies right away." kind="compact" />
    <G.Switch label="Show the waiting count" description="Shows how many turns are waiting." kind="compact" defaultSelected />
    <G.Switch label="Dark theme" isLabelHidden />
  </div>
);

export const OffTrackOnWhite: Story = { render: offTrackRender, };
export const OffTrackOnWhiteAt390: Story = { parameters: PHONE, render: offTrackRender, };
