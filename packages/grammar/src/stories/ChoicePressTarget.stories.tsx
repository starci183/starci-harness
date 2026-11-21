import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
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

const isOn = (input: HTMLInputElement) => input.checked;

/** The `<label>` the vendor makes pressable: the input's own label (React Aria wraps the visually hidden input in it). */
const pressableOf = (input: HTMLInputElement): HTMLLabelElement => {
  const label = input.closest('label');
  if (label === null) throw new Error(`${input.getAttribute('role') ?? input.type} input sits in no label`);
  return label;
};

/** What Playwright `check()` and a real pointer press: the topmost element at the centre of the element's box, which must be inside the pressable label. */
const hitAt = (element: Element): Element => {
  element.scrollIntoView({ block: 'center', inline: 'center' });
  const box = element.getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  if (hit === null) throw new Error('nothing is hit at the centre of the box');
  return hit;
};

const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(0.5);

/**
 * The pressable box grows no pseudo-element hit layer, on itself or on the drawn control: a drawn `::before` or `::after` (the vendor's checkbox fill) stays
 * inside its element's box, every inset at or above 0, so nothing beyond the drawn box takes a press.
 */
const noHitLayer = (element: Element) => {
  for (const pseudo of ['::before', '::after'] as const) {
    const style = getComputedStyle(element, pseudo);
    if (style.content === 'none' || style.content === 'normal' || style.display === 'none') continue;
    if (style.position !== 'absolute' && style.position !== 'fixed') continue;
    for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
      const inset = Number.parseFloat(style[edge]);
      expect(Number.isNaN(inset) || inset >= -0.5, `${element.className} ${pseudo} reaches ${style[edge]} past its ${edge} edge`).toBe(true);
    }
  }
};

const assertSwitchPresses = async (canvasElement: HTMLElement) => {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getAllByRole('switch').length).toBeGreaterThanOrEqual(5));
  for (const name of [...SWITCHES, 'Auto reply', 'Show the waiting count']) {
    const input = canvas.getByRole<HTMLInputElement>('switch', { name: new RegExp(`^${name}`) });
    const root = input.closest<HTMLElement>('[data-component="Switch"]')!;
    const track = root.querySelector<HTMLElement>('[data-grammar-switch-track="true"]')!;
    const label = pressableOf(input);

    // The drawn track is inside the pressable label.
    expect(label.contains(track), `${name}: the track is inside the pressable label`).toBe(true);
    // A hidden-label switch: the pressable box IS the drawn track (nothing larger to hit, nothing smaller drawn).
    if (root.getAttribute('data-grammar-switch-labelled') === 'false') {
      const pressBox = label.getBoundingClientRect();
      const trackBox = track.getBoundingClientRect();
      near(pressBox.left, trackBox.left);
      near(pressBox.top, trackBox.top);
      near(pressBox.width, trackBox.width);
      near(pressBox.height, trackBox.height);
      expect(Math.round(trackBox.height)).toBe(root.getAttribute('data-grammar-switch-kind') === 'compact' ? 18 : 40);
    }
    noHitLayer(label);
    noHitLayer(track);

    // A click on the drawn track toggles, and toggles back.
    const before = isOn(input);
    await userEvent.click(track);
    await waitFor(() => expect(isOn(input)).toBe(!before));
    expect(root.getAttribute('data-selected') === 'true', `${name}: the root states the selection`).toBe(!before);
    await userEvent.click(track);
    await waitFor(() => expect(isOn(input)).toBe(before));

    // Playwright `check()`: the topmost element at the centre of the switch's box is inside the pressable label, and pressing it toggles.
    const hit = hitAt(label);
    expect(label.contains(hit), `${name}: the centre of the press box hits ${hit.outerHTML.slice(0, 120)}`).toBe(true);
    const trackHit = hitAt(track);
    expect(label.contains(trackHit), `${name}: the centre of the track hits ${trackHit.outerHTML.slice(0, 120)}`).toBe(true);
    await userEvent.click(trackHit);
    await waitFor(() => expect(isOn(input)).toBe(!before));

    // Focus and Space.
    input.focus();
    expect(document.activeElement).toBe(input);
    await userEvent.keyboard(' ');
    await waitFor(() => expect(isOn(input)).toBe(before));
    expect(input.getAttribute('role')).toBe('switch');
  }
  // The hidden label still names the switch.
  expect(canvas.getByRole('switch', { name: SWITCHES[0] })).toBeTruthy();
};

/** Checkbox and Radio already draw their control inside the pressable label (checked here so they stay that way). */
const assertOtherChoices = async (canvasElement: HTMLElement) => {
  const canvas = within(canvasElement);
  const checkbox = await canvas.findByRole<HTMLInputElement>('checkbox', { name: 'Remember me' });
  const box = pressableOf(checkbox).querySelector<HTMLElement>('[data-grammar-choice-control="checkbox"]')!;
  expect(pressableOf(checkbox).contains(hitAt(box)), 'the checkbox box is hit inside its label').toBe(true);
  noHitLayer(box);
  await userEvent.click(box);
  await waitFor(() => expect(checkbox.checked).toBe(true));
  checkbox.focus();
  await userEvent.keyboard(' ');
  await waitFor(() => expect(checkbox.checked).toBe(false));

  const pro = canvas.getByRole<HTMLInputElement>('radio', { name: 'Pro' });
  const dot = pressableOf(pro).querySelector<HTMLElement>('[data-grammar-choice-control="radio"]')!;
  expect(pressableOf(pro).contains(hitAt(dot)), 'the radio dot is hit inside its label').toBe(true);
  noHitLayer(dot);
  await userEvent.click(dot);
  await waitFor(() => expect(pro.checked).toBe(true));
};

const play = async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  await assertSwitchPresses(canvasElement);
  await assertOtherChoices(canvasElement);
};

/** A permission matrix of compact hidden-label switches, a bare toggle, labelled rows, a checkbox and a radio group: each toggles on a press of what is drawn. */
export const DrawnControlIsThePressTarget: Story = { render, play };
export const DrawnControlIsThePressTargetAt390: Story = { parameters: PHONE, render, play };
