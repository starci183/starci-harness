import type { Meta, StoryObj } from '@storybook/react-vite';
import * as G from '../common/index.js';

/**
 * The drawn control is the press target (0.54.1). A choice control toggles on a press of what is drawn: the Switch track, the Checkbox box, the Radio
 * dot. The element the vendor makes pressable (the `<label>` around the visually hidden input) holds the drawn control and, for a hidden-label control,
 * is exactly the drawn box: no invisible hit layer, no size change. 0.54.0 drew the Switch track outside that label, so a compact hidden-label Switch
 * (a permission matrix cell) toggled by nothing: not a click on its track, not Playwright `check()`, not focus and Space.
 */
const meta: Meta = { title: 'Controls/Choice press target' };
export default meta;
type Story = StoryObj;

const PHONE = { viewport: { value: 'phone375', isRotated: false } };

const SWITCHES = ['Duyệt tin gửi ra ngoài công ty', 'Xem báo cáo', 'Dark theme'] as const;

const render = () => (
  <div style={{ width: 420, display: 'flex', flexDirection: 'column', gap: 16 }}>
    <table>
      <tbody>
        <tr>
          <td>Duyệt tin</td>
          <td><G.Switch label={SWITCHES[0]} isLabelHidden kind="compact" /></td>
          <td><G.Switch label={SWITCHES[1]} isLabelHidden kind="compact" defaultSelected /></td>
        </tr>
      </tbody>
    </table>
    <G.Switch label={SWITCHES[2]} isLabelHidden kind="toggle" />
    <G.Switch label="Auto reply" description="The assistant replies right away." kind="compact" />
    <G.Switch label="Show the waiting count" description="Shows how many turns are waiting." />
    <G.Checkbox label="Remember me" />
    <G.RadioGroup label="Plan" isLabelHidden options={[{ value: 'free', label: 'Free' }, { value: 'pro', label: 'Pro' }]} />
  </div>
);

const play = async () => {
};

/** A permission matrix of compact hidden-label switches, a bare toggle, labelled rows, a checkbox and a radio group: each toggles on a press of what is drawn. */
export const DrawnControlIsThePressTarget: Story = { render, play };
export const DrawnControlIsThePressTargetAt390: Story = { parameters: PHONE, render, play };
