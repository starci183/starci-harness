import type { Meta, StoryObj } from '@storybook/react-vite';
import * as G from '../common/index.js';

/**
 * Two layout fixes. A list row that carries a `value`, `badges` and an end `action` is one line (name block, value, badge, command at the end,
 * vertically centred); the value is a grid track of its own, so the command no longer drops under it. An Alert's stacked action button (below 30rem)
 * stays inside the banner's box and padding, and the banner grows to contain it.
 */
const meta: Meta = { title: 'Row value and Alert stack (0.37.36)', parameters: { grammar: { bleed: false } } };
export default meta;
type Story = StoryObj;

const noop = () => undefined;
const muted = (text: string) => <span style={{ display: 'block', color: 'var(--muted)', fontSize: 'var(--grammar-text-sm)' }}>{text}</span>;

const ROWS = [
  { id: 'fee', title: 'City delivery fee', description: <G.Text as="span" role="caption">Document · Shop rules</G.Text>, value: <span>$3.00 per order</span>, badges: [{ label: '1 proposal', tone: 'warning' }] as const, actionPlacement: 'end' as const, action: { label: 'Edit', press: noop } },
  { id: 'fast', title: 'Express delivery after 18:00', description: <G.Text as="span" role="caption">No source yet</G.Text>, value: <span>Not set</span>, badges: [{ label: '1 proposal', tone: 'warning' }] as const, actionPlacement: 'end' as const, action: { label: 'Set', press: noop } },
  { id: 'two', title: 'Returns', description: <G.Text as="span" role="caption">Returns policy</G.Text>, value: <span>Within 7 days{muted('from 01/11')}</span>, actionPlacement: 'end' as const, action: { label: 'Edit', press: noop } },
];

export const ValueBadgeAndEndAction: Story = {
  name: 'List row: value, badge and end action at 1440',
  render: () => (
    <div data-host style={{ inlineSize: 1440 }}>
      <G.Section kind="list" title="Delivery" items={ROWS} empty={<G.EmptyNotice message="Empty" />} />
    </div>
  ),
};

export const ValueBadgeAndEndActionAt390: Story = {
  name: 'List row: value, badge and end action at 390',
  render: () => (
    <div data-host style={{ inlineSize: 390 }}>
      <G.Section kind="list" title="Delivery" items={ROWS} empty={<G.EmptyNotice message="Empty" />} />
    </div>
  ),
};

// The Stack is given a definite height (a page well that is height-bound): the banner's own height is then definite too, the case that drew the button outside the box.
const StackedAlert = () => (
  <div style={{ display: 'grid', gridTemplateRows: '260px' }}>
  <G.Stack gap="section">
    <G.Alert tone="neutral" title="Policy not inferred yet" description="The shop is out of credit. Top up and try again." action={{ label: 'Retry', onAction: noop }} />
    <G.Section kind="list" title="Delivery" items={ROWS.slice(0, 1)} empty={<G.EmptyNotice message="Empty" />} />
  </G.Stack>
  </div>
);

export const AlertStackedActionAt390: Story = {
  name: 'Alert: stacked action stays in the banner at 390',
  render: () => <div data-host style={{ inlineSize: 390 }}><StackedAlert /></div>,
};

export const AlertActionAt1440: Story = {
  name: 'Alert: action at the end at 1440',
  render: () => <div data-host style={{ inlineSize: 1440 }}><StackedAlert /></div>,
};
