import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { userEvent } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * A BOARD CARD THAT IS DRAGGED. The card shows its grip (six dots) on hover and focus; while it is dragged it leaves an ORIGIN SLOT (a dashed, emptied place) where it stood and
 * travels as a lifted card (a soft shadow, no tilt); the stage under it opens a DROP SLOT (a dashed card-sized place with the stage's `dropHint`); the `endBand` is one more place
 * after the last stage, drawn only while dragging. `canDrop` answers `boardAllow`, `boardRefuse(reason)` or `boardNeedsData(kind)`: the last takes the drop but leaves the card where
 * it was and hands the app `onNeedsData` so it can ask (a booking time, the reason a lead was lost) and move the card itself once the person confirms. The keyboard path is Alt and an
 * arrow, held to the same answers.
 */
const meta: Meta = { title: 'Surfaces/Board drag and drop', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

type Stages = Readonly<Record<string, ReadonlyArray<string>>>;
const names: Readonly<Record<string, string>> = { ada: 'Ada Lovelace', bo: 'Bo Chen', cy: 'Cy Young', di: 'Di Prince' };

const Pipeline = ({ onAsk }: { readonly onAsk?: (kind: string) => void }) => {
  const [stages, setStages] = useState<Stages>({ new: ['ada', 'bo'], talking: ['cy'], booked: [], won: ['di'] });
  const [asked, setAsked] = useState('');
  const rows = (id: string) => (stages[id] ?? []).map((item) => ({ id: item, title: names[item] ?? item, description: 'From the web form' }));
  const columns: ReadonlyArray<G.BoardColumn> = [
    { id: 'new', title: 'New', count: rows('new').length, items: rows('new'), empty: <G.EmptyNotice message="Nothing new" /> },
    { id: 'talking', title: 'Talking', count: rows('talking').length, items: rows('talking'), empty: <G.EmptyNotice message="Nobody yet" /> },
    {
      id: 'booked',
      title: 'Booked',
      count: rows('booked').length,
      items: rows('booked'),
      empty: <G.EmptyNotice message="Nothing booked" />,
      dropHint: { title: 'Drop to book', detail: 'We will ask when the customer comes' },
      canDrop: () => G.boardNeedsData('booking'),
    },
    {
      id: 'won',
      title: 'Won',
      count: rows('won').length,
      items: rows('won'),
      empty: <G.EmptyNotice message="Nothing won" />,
      dropHint: { title: 'Drop to close' },
      canDrop: (move) => (move.fromColumnId === 'new' ? G.boardRefuse('Talk to the customer before closing') : G.boardAllow),
    },
  ];
  return (
    <>
      <G.Board
        label="Sales pipeline"
        columns={columns}
        endBand={{ id: 'lost', label: 'Drop here when the customer did not buy', canDrop: () => G.boardNeedsData('lost-reason') }}
        onMove={({ itemId, fromColumnId, toColumnId }) => setStages((current) => ({ ...current, [fromColumnId]: (current[fromColumnId] ?? []).filter((id) => id !== itemId), ...(toColumnId === 'lost' ? {} : { [toColumnId]: [...(current[toColumnId] ?? []), itemId] }) }))}
        onNeedsData={(_move, kind) => { setAsked(kind); onAsk?.(kind); }}
        moveLabels={{
          instructions: 'Alt and the left or right arrow move this card to the previous or next stage.',
          announce: (item, column) => `Moved ${item} to ${column}`,
          announceAsk: (item, column) => `Asking for details before moving ${item} to ${column}`,
        }}
      />
      <p data-asked={asked}>{asked === '' ? 'No question asked' : `Asking for: ${asked}`}</p>
    </>
  );
};

const boxOf = (root: ParentNode, selector: string): HTMLElement => {
  const found = root.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`no element for ${selector}`);
  return found;
};
const dragEvent = (type: string, transfer: DataTransfer) => new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer });
const settle = () => new Promise<void>((resolve) => { setTimeout(resolve, 50); });

/** Dragging a card: the origin slot where it stood, the drop slot with its hint in the stage under it, and the end band that appears only now. */
export const DragStates: Story = {
  render: () => <Pipeline />,
  play: async ({ canvasElement }) => {
    const columns = [...canvasElement.querySelectorAll<HTMLElement>('.starci-core-board-column')];
    const ada = boxOf(canvasElement, '[data-grammar-row-id="ada"]');
    const transfer = new DataTransfer();
    ada.dispatchEvent(dragEvent('dragstart', transfer));
    await settle();
    const booked = columns[2] as HTMLElement;
    const over = dragEvent('dragover', transfer);
    booked.dispatchEvent(over);
    ada.dispatchEvent(dragEvent('dragend', transfer));
  },
};

/** needsData: the drop is taken, the card stays where it was, and the app is asked for the booking; the end band asks for the reason a lead was lost. The keyboard asks the same. */
export const NeedsData: Story = {
  render: () => {
    const asked: string[] = [];
    return <Pipeline onAsk={(kind) => { asked.push(kind); }} />;
  },
  play: async ({ canvasElement }) => {
    const columns = [...canvasElement.querySelectorAll<HTMLElement>('.starci-core-board-column')];
    const cy = boxOf(canvasElement, '[data-grammar-row-id="cy"]');
    const transfer = new DataTransfer();
    cy.dispatchEvent(dragEvent('dragstart', transfer));
    await settle();
    const booked = columns[2] as HTMLElement;
    booked.dispatchEvent(dragEvent('dragover', transfer));
    booked.dispatchEvent(dragEvent('drop', transfer));
    // Alt and the right arrow on the card in the Booked column's neighbour asks the same question.
    const di = boxOf(canvasElement, '[data-grammar-row-id="di"]');
    di.focus();
    await userEvent.keyboard('{Alt>}{ArrowLeft}{/Alt}');
  },
};

/** The refused answer: a customer who was never talked to cannot be closed; the reason is written in the stage and announced. */
export const Refused: Story = {
  render: () => <Pipeline />,
  play: async ({ canvasElement }) => {
    const columns = [...canvasElement.querySelectorAll<HTMLElement>('.starci-core-board-column')];
    const bo = boxOf(canvasElement, '[data-grammar-row-id="bo"]');
    const transfer = new DataTransfer();
    bo.dispatchEvent(dragEvent('dragstart', transfer));
    await settle();
    const won = columns[3] as HTMLElement;
    const over = dragEvent('dragover', transfer);
    won.dispatchEvent(over);
    bo.dispatchEvent(dragEvent('dragend', transfer));
  },
};

/** The drag held mid-air (the proof picture): the origin slot, the drop slot with its hint in the stage under the pointer, and the end band. */
export const MidDrag: Story = {
  render: () => <Pipeline />,
  play: async ({ canvasElement }) => {
    const columns = [...canvasElement.querySelectorAll<HTMLElement>('.starci-core-board-column')];
    const ada = boxOf(canvasElement, '[data-grammar-row-id="ada"]');
    const transfer = new DataTransfer();
    ada.dispatchEvent(dragEvent('dragstart', transfer));
    await settle();
    (columns[2] as HTMLElement).dispatchEvent(dragEvent('dragover', transfer));
  },
};
