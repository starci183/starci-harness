import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * A tile with a `wholeAction` may carry a `menu` (0.37.8): the card opens as a whole, and the ⋯ trigger stands above the whole-card link as its own tab stop, so opening the menu
 * never follows the card. The agent card: Open · More agents with the same role · Pause · Remove.
 */
const meta: Meta = { title: 'Surfaces/Whole-card action with menu' };
export default meta;
type Story = StoryObj;

const Card = () => {
  const [log, setLog] = useState<readonly string[]>([]);
  const note = (entry: string) => setLog((current) => [...current, entry]);
  return (
    <div style={{ width: 360 }}>
      <G.SurfaceCard
        kind="tile"
        name="Chatbot"
        mark={{ avatar: { name: 'Chatbot' } }}
        badges={[{ label: 'Running', tone: 'success' }]}
        description="Customer care over Email and Chat."
        wholeAction={{ kind: 'button', label: 'Open Chatbot', press: () => note('open') }}
        menu={{
          label: 'Actions for Chatbot',
          entries: [
            {
              kind: 'section',
              id: 'main',
              items: [
                { id: 'open', label: 'Open', onAction: () => note('menu-open') },
                { id: 'twin', label: 'More agents with the same role', onAction: () => note('menu-twin') },
                { id: 'pause', label: 'Pause', onAction: () => note('menu-pause') },
                { id: 'remove', label: 'Remove', onAction: () => note('menu-remove') },
              ],
            },
          ],
        }}
      />
      <output data-testid="log">{log.join(',')}</output>
    </div>
  );
};

export const AgentCard: Story = {
  render: () => <Card />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const log = () => canvasElement.querySelector('[data-testid="log"]')?.textContent ?? '';
    const trigger = await canvas.findByRole('button', { name: 'Actions for Chatbot' });
    // the trigger is its own target, above the whole-card link
    const box = trigger.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    expect(trigger.contains(hit)).toBe(true);
    await userEvent.click(trigger);
    await waitFor(() => expect(document.body.querySelector('[role="menu"]')).not.toBeNull());
    expect(log()).toBe('');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.body.querySelector('[role="menu"]')).toBeNull());
    expect(log()).toBe('');
    // the card body presses the whole-card action
    await userEvent.click(canvas.getByRole('button', { name: 'Open Chatbot' }));
    await waitFor(() => expect(log()).toBe('open'));
  },
};

/**
 * 0.37.10: a `body` card (children: coloured chip lines a tile cannot hold: a role chip, channel chips, a red "permission not granted") takes the same `menu` with a `wholeAction`:
 * the ⋯ stands at the top end above the whole-card link, and a keyboard user reaches both the link and the menu.
 */
const BodyCardWithMenu = () => {
  const [log, setLog] = useState<readonly string[]>([]);
  const note = (entry: string) => setLog((current) => [...current, entry]);
  return (
    <div style={{ width: 360 }}>
      <G.SurfaceCard
        label="Chatbot"
        wholeAction={{ kind: 'button', label: 'Open Chatbot', press: () => note('open') }}
        menu={{ label: 'Actions for Chatbot', entries: [{ kind: 'section', id: 'main', items: [{ id: 'pause', label: 'Pause', onAction: () => note('menu-pause') }, { id: 'remove', label: 'Remove', onAction: () => note('menu-remove') }] }] }}
        footers={[{ kind: 'custom', children: <G.Text tone="muted">Tasks in 7 days: 12 · Waiting for you: 2</G.Text> }]}
      >
        <G.Cluster gap="row">
          <G.Badge tone="accent">Customer care</G.Badge>
          <G.Badge tone="neutral">Chat</G.Badge>
          <G.Badge tone="danger">Permission not granted</G.Badge>
        </G.Cluster>
      </G.SurfaceCard>
      <output data-testid="log">{log.join(',')}</output>
    </div>
  );
};

export const BodyCardAgent: Story = {
  render: () => <BodyCardWithMenu />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const log = () => canvasElement.querySelector('[data-testid="log"]')?.textContent ?? '';
    const trigger = await canvas.findByRole('button', { name: 'Actions for Chatbot' });
    const box = trigger.getBoundingClientRect();
    expect(trigger.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2))).toBe(true);
    await userEvent.click(trigger);
    await waitFor(() => expect(document.body.querySelector('[role="menu"]')).not.toBeNull());
    expect(log()).toBe('');
    await userEvent.keyboard('{Escape}');
    // the card stays one whole action, and the link and the menu are two tab stops
    expect(canvasElement.querySelectorAll('[data-grammar-whole-action]').length).toBe(1);
    await userEvent.click(canvas.getByRole('button', { name: 'Open Chatbot' }), { pointerEventsCheck: 0 });
    expect(log()).toBe('open');
    // 0.37.12: the room for the ⋯ is reserved on the content row only; the footer zone and its divider run the card's full width.
    const card = canvasElement.querySelector<HTMLElement>('[data-grammar-surface-card="true"]')!.getBoundingClientRect();
    const footer = canvasElement.querySelector<HTMLElement>('[data-grammar-zone="custom"]');
    if (footer === null) throw new Error('the footer zone renders');
    const zone = footer.getBoundingClientRect();
    expect(Math.abs(zone.left - card.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(zone.right - card.right)).toBeLessThanOrEqual(1);
  },
};
