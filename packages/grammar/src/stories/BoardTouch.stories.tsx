import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { userEvent } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * A BOARD CARD MOVED ON A PHONE, AND BY THE KEYBOARD. The Board's drag is react-aria's (`useDrag` on the card, `useDrop` on each stage), so a touch
 * screen lifts a card on a long press and drags it with the finger, and a card held near the left or right edge of the stages scrolls them one
 * stage at a time: a phone shows one stage, and the stage the card is meant for is off screen. The keyboard and a screen reader take the same
 * path: Enter on a focused card starts the drag, Tab walks the stages (each is focused and read by its title), Enter drops, Escape cancels.
 */
const meta: Meta = { title: 'Surfaces/Board touch and keyboard drag', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

type Stages = Readonly<Record<string, ReadonlyArray<string>>>;
const names: Readonly<Record<string, string>> = { ada: 'Ada Lovelace', bo: 'Bo Chen', cy: 'Cy Young', di: 'Di Prince' };

const Pipeline = () => {
  const [stages, setStages] = useState<Stages>({ new: ['ada', 'bo'], talking: ['cy'], booked: [], won: ['di'] });
  const rows = (id: string) => (stages[id] ?? []).map((item) => ({ id: item, title: names[item] ?? item, description: 'From the web form' }));
  const columns: ReadonlyArray<G.BoardColumn> = [
    { id: 'new', title: 'New', count: rows('new').length, items: rows('new'), empty: <G.EmptyNotice message="Nothing new" /> },
    { id: 'talking', title: 'Talking', count: rows('talking').length, items: rows('talking'), empty: <G.EmptyNotice message="Nobody yet" />, dropHint: { title: 'Drop to start talking', detail: 'The customer hears from us today' } },
    { id: 'booked', title: 'Booked', count: rows('booked').length, items: rows('booked'), empty: <G.EmptyNotice message="Nothing booked" />, dropHint: { title: 'Drop to book', detail: 'We will ask when the customer comes' }, canDrop: () => G.boardNeedsData('booking') },
    { id: 'won', title: 'Won', count: rows('won').length, items: rows('won'), empty: <G.EmptyNotice message="Nothing won" />, dropHint: { title: 'Drop to close' } },
  ];
  return (
    <G.Board
      label="Sales pipeline"
      columns={columns}
      onMove={({ itemId, fromColumnId, toColumnId }) => setStages((current) => ({ ...current, [fromColumnId]: (current[fromColumnId] ?? []).filter((id) => id !== itemId), [toColumnId]: [...(current[toColumnId] ?? []), itemId] }))}
      onNeedsData={() => undefined}
      moveLabels={{
        instructions: 'Alt and the left or right arrow move this card to the previous or next stage.',
        announce: (item, column) => `Moved ${item} to ${column}`,
        announceAsk: (item, column) => `Asking for details before moving ${item} to ${column}`,
      }}
    />
  );
};

const boxOf = (root: ParentNode, selector: string): HTMLElement | null => root.querySelector<HTMLElement>(selector);
const settle = (ms = 50) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });
const dragAt = (target: Element, type: string, transfer: DataTransfer, x: number, y: number) =>
  target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: transfer, clientX: x, clientY: y }));

/**
 * A finger long-presses Ada's card and holds it at the right edge of the stages: on a phone the stages scroll one stage over and the next stage
 * opens its drop slot; on a wide screen every stage is in view, nothing scrolls, and the stage under the finger opens its slot. The card left
 * its origin slot where it stood.
 */
export const TouchDragAtEdge: Story = {
  render: () => <Pipeline />,
  play: async ({ canvasElement }) => {
    const ada = boxOf(canvasElement, '[data-grammar-row-id="ada"]');
    const scroller = boxOf(canvasElement, '.starci-core-board');
    if (ada === null || scroller === null) return;
    const card = ada.getBoundingClientRect();
    ada.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: card.left + 24, clientY: card.top + 16 }));
    const transfer = new DataTransfer();
    dragAt(ada, 'dragstart', transfer, card.left + 24, card.top + 16);
    await settle();
    const box = scroller.getBoundingClientRect();
    const edgeX = Math.min(box.right, window.innerWidth) - 8;
    const y = card.top + 16;
    const under = document.elementFromPoint(edgeX, y)?.closest('.starci-core-board-column') ?? canvasElement.querySelectorAll('.starci-core-board-column')[1];
    if (under === undefined) return;
    dragAt(under, 'dragenter', transfer, edgeX, y);
    dragAt(under, 'dragover', transfer, edgeX, y);
    await settle(400);
  },
};

/** The keyboard path a screen reader shares: Enter on the focused card starts the drag, and the drag focuses the first stage it can drop on. */
export const KeyboardDrag: Story = {
  render: () => <Pipeline />,
  play: async ({ canvasElement }) => {
    const ada = boxOf(canvasElement, '[data-grammar-row-id="ada"]');
    if (ada === null) return;
    ada.focus();
    await userEvent.keyboard('{Enter}');
    await settle(200);
  },
};
