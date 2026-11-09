import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * A tile with a `wholeAction` may carry a `menu` (0.37.8): the card opens as a whole, and the ⋯ trigger stands above the whole-card link as its own tab stop, so opening the menu
 * never follows the card. The agent card: Mở · Thêm agent cùng vai trò · Tạm dừng · Gỡ.
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
        badges={[{ label: 'Đang chạy', tone: 'success' }]}
        description="Chăm sóc khách trên Zalo OA và Telegram."
        wholeAction={{ kind: 'button', label: 'Mở Chatbot', press: () => note('open') }}
        menu={{
          label: 'Thao tác với Chatbot',
          entries: [
            {
              kind: 'section',
              id: 'main',
              items: [
                { id: 'open', label: 'Mở', onAction: () => note('menu-open') },
                { id: 'twin', label: 'Thêm agent cùng vai trò', onAction: () => note('menu-twin') },
                { id: 'pause', label: 'Tạm dừng', onAction: () => note('menu-pause') },
                { id: 'remove', label: 'Gỡ', onAction: () => note('menu-remove') },
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
    const trigger = await canvas.findByRole('button', { name: 'Thao tác với Chatbot' });
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
    await userEvent.click(canvas.getByRole('button', { name: 'Mở Chatbot' }));
    await waitFor(() => expect(log()).toBe('open'));
  },
};
