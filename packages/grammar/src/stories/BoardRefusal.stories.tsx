import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * A BOARD COLUMN THAT REFUSES A DROP (0.46.2). `BoardColumn.canDrop(move)` returns `null` to let the card in or a reason to refuse it. A refusing column still shows as a drop
 * place that says no (a danger outline, its reason written in the column), the card is not moved (the drag is not accepted, so it springs back; `onMove` does not run), and the
 * reason is announced. The keyboard move (Alt and an arrow) is held to the same answer.
 */
const meta: Meta = { title: 'Surfaces/Board refused drop (0.46.2)', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

const REASON = 'Add a quote before it can be won';

const Pipeline = () => {
  const [stages, setStages] = useState<Readonly<Record<string, ReadonlyArray<string>>>>({ new: ['acme', 'alex'], won: [] });
  const quoted: ReadonlySet<string> = new Set(['alex']);
  const names: Readonly<Record<string, string>> = { acme: 'Acme Studio', alex: 'Alex Chen' };
  const columns: ReadonlyArray<G.BoardColumn> = [
    { id: 'new', title: 'New', count: (stages.new ?? []).length, items: (stages.new ?? []).map((id) => ({ id, title: names[id] ?? id, description: quoted.has(id) ? 'Quote sent' : 'No quote yet' })), empty: <G.EmptyNotice message="Nothing here" /> },
    {
      id: 'won',
      title: 'Won',
      count: (stages.won ?? []).length,
      items: (stages.won ?? []).map((id) => ({ id, title: names[id] ?? id, description: 'Won' })),
      empty: <G.EmptyNotice message="Nothing won yet" description="Drag a quoted card here." />,
      canDrop: (move) => (quoted.has(move.itemId) ? null : REASON),
    },
  ];
  return (
    <G.Board
      label="Sales pipeline"
      columns={columns}
      onMove={({ itemId, fromColumnId, toColumnId }) => setStages((current) => ({ ...current, [fromColumnId]: (current[fromColumnId] ?? []).filter((id) => id !== itemId), [toColumnId]: [...(current[toColumnId] ?? []), itemId] }))}
      moveLabels={{ instructions: 'Alt and the left or right arrow move this card to the previous or next stage.', announce: (item, column) => `Moved ${item} to ${column}` }}
    />
  );
};

const boxOf = (root: ParentNode, selector: string): HTMLElement => {
  const found = root.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`no element for ${selector}`);
  return found;
};

const dragEvent = (type: string, transfer: DataTransfer) => new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer });

/** Dragging the card with no quote over the Won column: the column refuses (not a drop place, the danger outline and the reason), the card stays, the reason is announced. A quoted card is let in. */
export const DragRefused: Story = {
  render: () => <Pipeline />,
  play: async ({ canvasElement }) => {
    const columns = [...canvasElement.querySelectorAll<HTMLElement>('.starci-core-board-column')];
    const won = columns[1] as HTMLElement;
    const acme = boxOf(canvasElement, '[data-grammar-row-id="acme"]');
    const transfer = new DataTransfer();
    acme.dispatchEvent(dragEvent('dragstart', transfer));
    // React flushes the drag start (the dragged card) after the event; the drag-over must see it.
    await new Promise<void>((resolve) => { setTimeout(resolve, 50); });
    const over = dragEvent('dragover', transfer);
    won.dispatchEvent(over);
    // Refused: the event was not cancelled, so the column is no drop place.
    expect(over.defaultPrevented).toBe(false);
    await waitFor(() => {
      expect(won.getAttribute('data-grammar-drop')).toBe('refused');
      expect(boxOf(won, '[data-grammar-board-refusal="true"]').textContent).toBe(REASON);
    });
    // The drag ends without a drop: the card is where it was, and the reason is announced.
    acme.dispatchEvent(dragEvent('dragend', transfer));
    await waitFor(() => {
      expect(boxOf(canvasElement, '.starci-core-board-announce').textContent).toBe(REASON);
      expect(boxOf(columns[0] as HTMLElement, '[data-grammar-row-id="acme"]')).not.toBeNull();
      expect(won.querySelector('[data-grammar-row-id="acme"]')).toBeNull();
    });
    // A card that has a quote is let in: the drag-over is accepted.
    const alex = boxOf(canvasElement, '[data-grammar-row-id="alex"]');
    const second = new DataTransfer();
    alex.dispatchEvent(dragEvent('dragstart', second));
    await new Promise<void>((resolve) => { setTimeout(resolve, 50); });
    const accepted = dragEvent('dragover', second);
    won.dispatchEvent(accepted);
    expect(accepted.defaultPrevented).toBe(true);
    await waitFor(() => { expect(won.getAttribute('data-grammar-drop')).toBe('true'); });
    alex.dispatchEvent(dragEvent('dragend', second));
  },
};

/** The keyboard move holds to the same answer: Alt and the right arrow on the card with no quote is refused and announced; on the quoted card it moves. */
export const KeyboardRefused: Story = {
  render: () => <Pipeline />,
  play: async ({ canvasElement }) => {
    const acme = boxOf(canvasElement, '[data-grammar-row-id="acme"]');
    const focusable = acme.matches('[tabindex]') ? acme : boxOf(acme, 'button, [tabindex]');
    focusable.focus();
    await userEvent.keyboard('{Alt>}{ArrowRight}{/Alt}');
    await waitFor(() => {
      expect(boxOf(canvasElement, '.starci-core-board-announce').textContent).toBe(REASON);
      expect(canvasElement.querySelector('.starci-core-board-column:nth-child(2) [data-grammar-row-id="acme"]')).toBeNull();
      expect(boxOf(canvasElement, '[data-grammar-board-refusal="true"]').textContent).toBe(REASON);
    });
    const alex = boxOf(canvasElement, '[data-grammar-row-id="alex"]');
    (alex.matches('[tabindex]') ? alex : boxOf(alex, 'button, [tabindex]')).focus();
    await userEvent.keyboard('{Alt>}{ArrowRight}{/Alt}');
    await waitFor(() => {
      expect(canvasElement.querySelector('.starci-core-board-column:nth-child(2) [data-grammar-row-id="alex"]')).not.toBeNull();
      expect(boxOf(canvasElement, '.starci-core-board-announce').textContent).toBe('Moved Alex Chen to Won');
    });
  },
};
