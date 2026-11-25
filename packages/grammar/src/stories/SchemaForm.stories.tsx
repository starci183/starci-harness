import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import * as G from '../common/index.js';
import { Matrix, State } from './fixtures.js';

/**
 * A FORM DRAWN FROM A SCHEMA, and the agent surfaces beside it. `SchemaForm` takes the JSON Schema a zod schema emits (`z.toJSONSchema`) and draws one control per field: a line, several
 * lines, a number, a switch, a choice, an image or file in an upload slot, a list of lines, a list of rows the person adds to, removes and reorders (with a meter for a limit such as 15
 * seconds). The states of a form two hands fill: a field the person edited carries a marker so the agent leaves it alone, a field the agent is writing is read-only, a field the agent
 * proposes a change to shows the difference with Accept and Reject, a required field left empty says it is needed. `ApprovalCard` is the card of facts with a quick edit,
 * `WorkbenchSlot` the first tab of an agent (with its empty state), `NoteList` and `ConflictCard` what an agent remembers. Every word is the app's; here they are generic.
 */
const meta: Meta = { title: 'Forms/Schema form and agent surfaces', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

const script: G.SchemaFormField = {
  type: 'object',
  required: ['hook', 'scenes', 'cta'],
  properties: {
    hook: { type: 'string', title: 'Opening line', placeholder: 'A question that stops the scroll' },
    scenes: {
      type: 'array',
      title: 'Scenes',
      itemLabel: 'Scene',
      addLabel: 'Add a scene',
      maxItems: 8,
      items: {
        type: 'object',
        required: ['text', 'seconds'],
        properties: {
          text: { type: 'string', format: 'textarea', title: 'Words and picture' },
          seconds: { type: 'integer', title: 'Seconds', minimum: 1 },
        },
      },
    },
    cta: { type: 'string', title: 'Call to action', placeholder: 'Message us to book' },
    cover: { type: 'string', format: 'image', title: 'Cover image', accept: 'image/*' },
    tone: { oneOf: [{ const: 'warm', title: 'Warm' }, { const: 'direct', title: 'Direct' }], title: 'Voice' },
    paid: { type: 'boolean', title: 'Promote this video' },
  },
};

const labels: G.SchemaFormLabels = {
  edited: 'You edited',
  writing: 'Claude is writing',
  missing: 'Needed',
  proposes: 'Claude suggests',
  current: 'Now',
  suggested: 'Suggested',
  accept: 'Use it',
  reject: 'Keep mine',
  remove: (item) => `Remove ${item}`,
  moveUp: (item) => `Move ${item} up`,
  moveDown: (item) => `Move ${item} down`,
  atMost: (max) => `At most ${String(max)}`,
  uploadPrompt: 'Drop a picture or choose one',
  empty: 'Not set',
};

const meter: G.SchemaFormMeter = { valueKey: 'seconds', max: 15, name: 'Length', reading: (sum, max) => `${String(sum)} / ${String(max)} seconds` };

const filled: G.SchemaFormValue = {
  hook: 'Stiff neck after a long day at the desk?',
  scenes: [
    { text: 'Close up: a customer rubs her neck and frowns.', seconds: 3 },
    { text: 'The therapist presses hot stones on the shoulder.', seconds: 4 },
    { text: 'Warm water, a slow scalp massage.', seconds: 4 },
    { text: 'The customer smiles; the offer in big letters.', seconds: 4 },
  ],
  cta: 'Combo for 350k, Tuesday and Wednesday. Message us to book.',
  tone: 'warm',
  paid: false,
};

const Editable = ({ initial, marks, proposals, readOnly = false, editable, layout }: { readonly initial: G.SchemaFormValue; readonly marks?: Readonly<Record<string, G.SchemaFormMark>>; readonly proposals?: Readonly<Record<string, unknown>>; readonly readOnly?: boolean; readonly editable?: readonly string[]; readonly layout?: 'form' | 'kv' }) => {
  const [value, setValue] = useState<G.SchemaFormValue>(initial);
  const [decided, setDecided] = useState('');
  const [seen, setSeen] = useState<Readonly<Record<string, unknown>> | undefined>(proposals);
  return (
    <>
      <G.SchemaForm
        label="Video script"
        schema={script}
        value={value}
        onChange={setValue}
        labels={labels}
        meters={{ scenes: meter }}
        {...(marks === undefined ? {} : { marks })}
        {...(seen === undefined ? {} : { proposals: seen })}
        onProposal={(path, decision) => {
          setDecided(`${path}:${decision}`);
          if (decision === 'accept' && seen !== undefined) setValue((current) => G.withValueAt(current, path, seen[path]) as G.SchemaFormValue);
          setSeen((current) => (current === undefined ? current : Object.fromEntries(Object.entries(current).filter(([key]) => key !== path))));
        }}
        readOnly={readOnly}
        {...(editable === undefined ? {} : { editable })}
        {...(layout === undefined ? {} : { layout })}
      />
      <output data-decided={decided}>{decided}</output>
    </>
  );
};

/** A filled form: rows with their number and actions, the meter at 15 of 15 seconds, the choice, the switch and the upload zone. Add, remove and reorder act on the value. */
export const Filled: Story = {
  render: () => <Matrix maxWidth={760}><State label="Filled" direction="column"><Editable initial={filled} /></State></Matrix>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByRole('meter', { name: 'Length' })).toBeTruthy();
    expect(canvasElement.textContent).toContain('15 / 15 seconds');
    expect(canvasElement.querySelectorAll('[data-grammar-schema-row]').length).toBe(4);
    await userEvent.click(canvas.getByRole('button', { name: 'Add a scene' }));
    await waitFor(() => expect(canvasElement.querySelectorAll('[data-grammar-schema-row]').length).toBe(5));
    await userEvent.click(canvas.getByRole('button', { name: 'Remove Scene 5' }));
    await waitFor(() => expect(canvasElement.querySelectorAll('[data-grammar-schema-row]').length).toBe(4));
    await userEvent.click(canvas.getByRole('button', { name: 'Move Scene 1 down' }));
    await waitFor(() => expect(canvasElement.querySelector<HTMLTextAreaElement>('[data-grammar-schema-row="scenes.0"] textarea')?.value).toContain('hot stones'));
    expect(canvas.getByRole('button', { name: 'Move Scene 1 up' }).hasAttribute('disabled')).toBe(true);
  },
};

/** The states of a form two hands fill: missing, hand-edited, being written, with a proposal. A required field left empty says it is needed; the first row is missing its seconds. */
export const FieldStates: Story = {
  render: () => (
    <Matrix maxWidth={760}>
      <State label="Missing, edited, writing, proposed" direction="column">
        <Editable
          initial={{ hook: '', scenes: [{ text: 'Close up on the neck.', seconds: 3 }, { text: 'Hot stones on the shoulder' }], cta: 'Message us to book', tone: 'warm', paid: false }}
          marks={{ cta: 'edited', 'scenes.0.text': 'edited', 'scenes.1.text': 'writing' }}
          proposals={{ cta: 'Combo for 350k, Tuesday and Wednesday. Message us to book.' }}
        />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvasElement.querySelector('[data-grammar-schema-field="hook"]')?.getAttribute('data-grammar-schema-state')).toBe('missing');
    expect(canvasElement.querySelector('[data-grammar-schema-field="scenes.1.seconds"]')?.getAttribute('data-grammar-schema-state')).toBe('missing');
    expect(canvasElement.querySelector('[data-grammar-schema-field="scenes.1.text"]')?.getAttribute('data-grammar-schema-state')).toBe('writing');
    expect(canvasElement.querySelector('[data-grammar-schema-mark="edited"]')).not.toBeNull();
    expect(canvasElement.querySelector<HTMLTextAreaElement>('[data-grammar-schema-field="scenes.1.text"] textarea')?.readOnly).toBe(true);
    expect(canvas.getAllByText('Needed').length).toBeGreaterThan(1);
    const proposal = canvasElement.querySelector('[data-grammar-schema-proposal="cta"]');
    expect(proposal?.textContent).toContain('Claude suggests');
    expect(proposal?.querySelector('del')?.textContent).toBe('Message us to book');
    await userEvent.click(canvas.getByRole('button', { name: 'Use it' }));
    await waitFor(() => expect(canvasElement.querySelector('[data-grammar-schema-proposal="cta"]')).toBeNull());
    expect(canvasElement.querySelector<HTMLInputElement>('[data-grammar-schema-field="cta"] input')?.value).toContain('Combo for 350k');
    // Focus: a field shows its own ring.
    canvasElement.querySelector<HTMLInputElement>('[data-grammar-schema-field="hook"] input')?.focus();
    expect(document.activeElement?.closest('[data-grammar-schema-field]')?.getAttribute('data-grammar-schema-field')).toBe('hook');
  },
};

/** What is missing, as a list the app writes in its sticky foot. */
export const MissingList: Story = {
  render: () => <Matrix maxWidth={760}><State label="schemaFormMissing" direction="column"><p>{G.schemaFormMissing(script, { hook: 'x', scenes: [{ text: 'a' }], cta: '' }).join(' · ')}</p></State></Matrix>,
  play: async ({ canvasElement }) => {
    expect(canvasElement.textContent).toContain('scenes.0.seconds');
    expect(canvasElement.textContent).toContain('cta');
  },
};

const facts: G.SchemaFormField = {
  type: 'object',
  properties: {
    offer: { type: 'string', title: 'Offer' },
    hook: { type: 'string', title: 'Opening line' },
    scenes: { type: 'array', title: 'Scenes', items: { type: 'object', properties: { text: { type: 'string', title: 'Text' }, seconds: { type: 'integer', title: 'Seconds', unit: 'seconds' } } } },
    cta: { type: 'string', title: 'Call to action' },
  },
};

const factsValue: G.SchemaFormValue = {
  offer: 'Neck and shoulder combo with shampoo, 350k, Tuesday and Wednesday',
  hook: 'Stiff neck after a long day at the desk?',
  scenes: filled.scenes,
  cta: 'Message us to book.',
};

const Approval = () => {
  const [saved, setSaved] = useState<G.SchemaFormValue>(factsValue);
  const [approved, setApproved] = useState(false);
  return (
    <>
      <G.ApprovalCard
        title="Approve the 15 second video script"
        meta="Approve by 18:00 today"
        schema={facts}
        value={saved}
        editable={['cta']}
        onSave={setSaved}
        formLabels={labels}
        labels={{ edit: 'Quick edit', save: 'Save', cancel: 'Cancel' }}
        meters={{ scenes: meter }}
        approve={{ label: 'Approve', press: () => setApproved(true) }}
        open={{ label: 'Open the studio', href: '#studio' }}
        menu={{ label: 'More', entries: [{ id: 'decline', label: 'Decline', onAction: () => undefined }] }}
        note="Quick edit changes a field right on the card. Opening the studio keeps every field already written."
      />
      <output data-approved={approved ? 'yes' : 'no'}>{approved ? 'Approved' : 'Waiting'}</output>
    </>
  );
};

/** The approval card: the facts as words, one field fixable in place, the approval held while the edit is open. */
export const ApprovalCardStory: Story = {
  name: 'ApprovalCard',
  render: () => <Matrix maxWidth={720}><State label="Approval" direction="column"><Approval /></State></Matrix>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvasElement.querySelectorAll('input').length).toBe(0);
    await userEvent.click(canvas.getByRole('button', { name: 'Quick edit' }));
    await waitFor(() => expect(canvasElement.querySelectorAll('input').length).toBe(1));
    expect(canvas.getByRole('button', { name: 'Approve' }).hasAttribute('disabled')).toBe(true);
    const input = canvasElement.querySelector<HTMLInputElement>('input') as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, 'Book by message.');
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(canvasElement.textContent).toContain('Book by message.'));
    expect(canvasElement.querySelectorAll('input').length).toBe(0);
    await userEvent.click(canvas.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(canvasElement.querySelector('[data-approved="yes"]')).not.toBeNull());
  },
};

const notes: readonly G.NoteRowData[] = [
  { id: 'n1', kind: 'Rule', source: 'from the setup chat, 26 Nov', text: 'A customer who haggles gets 10% off at most. More needs the owner first.', scope: { label: 'Whole shop' }, usage: { label: 'in 14 runs', href: '#runs' }, edit: { label: 'Edit', press: () => undefined }, menu: { label: 'More', entries: [{ id: 'stop', label: 'Stop using', onAction: () => undefined }] } },
  { id: 'n2', kind: 'Voice', source: 'from the setup chat, 26 Nov', text: 'Say "we" for the shop and "you" to the customer. Short sentences.', scope: { label: 'Ads only', promote: { label: 'Make it shop-wide', press: () => undefined } }, usage: { label: 'in 9 runs', href: '#runs' }, edit: { label: 'Edit', press: () => undefined } },
  { id: 'n3', kind: 'Rule', source: 'from the setup chat, 12 Nov', text: 'A single ad above 200k a day always asks the owner first.', scope: { label: 'Ads only' }, usage: { label: 'not used yet' }, edit: { label: 'Edit', press: () => undefined } },
];

/** The agent's first tab and what it remembers: the workbench slot with its empty state over the fallback, the notes, and two notes that disagree. */
export const AgentSurfaces: Story = {
  render: () => (
    <Matrix maxWidth={900}>
      <State label="WorkbenchSlot, empty" direction="column">
        <G.WorkbenchSlot label="Workbench of Care" empty={{ title: 'This agent has no workbench yet', description: 'The pack made no screen for it. The agent still works; here is what it did lately.' }}>
          <G.Section kind="list" ariaLabel="Recent runs" items={[{ id: 'r1', title: 'Asked a customer why she left the booking', description: 'Yesterday 20:14' }, { id: 'r2', title: 'Answered a price question', description: 'Today 10:12' }]} empty={<G.EmptyNotice message="No runs" />} />
        </G.WorkbenchSlot>
      </State>
      <State label="NoteList" direction="column">
        <G.NoteList label="What the agent remembers" notes={notes} columns={{ note: 'Note', scope: 'Applies to', usage: 'Used' }} empty={<G.EmptyNotice message="Nothing yet" />} />
      </State>
      <State label="NoteList, loading" direction="column">
        <G.NoteList label="What the agent remembers" notes={[]} columns={{ note: 'Note', scope: 'Applies to', usage: 'Used' }} empty={<G.EmptyNotice message="Nothing yet" />} isLoading />
      </State>
      <State label="ConflictCard" direction="column">
        <G.ConflictCard
          title="Two notes disagree about discounts"
          current={{ label: 'Remembered now', text: 'A customer who haggles gets 10% off at most.', source: 'setup chat, 18 Nov' }}
          proposed={{ label: 'New suggestion', text: 'Give up to 15% off to customers who booked before.', source: 'setup chat, today' }}
          choices={[{ label: 'Keep the old', press: () => undefined }, { label: 'Use the new', press: () => undefined }, { label: 'Keep both', press: () => undefined }]}
          note="The note you do not keep stops being used; you can bring it back from the history."
        />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByRole('region', { name: 'Workbench of Care' })).toBeTruthy();
    expect(canvas.getByText('This agent has no workbench yet')).toBeTruthy();
    expect(within(canvas.getAllByRole('list', { name: 'What the agent remembers' })[0] as HTMLElement).getAllByRole('listitem')).toHaveLength(3);
    expect(canvas.getByRole('button', { name: 'Make it shop-wide' })).toBeTruthy();
    expect(canvas.getByRole('region', { name: 'Remembered now' })).toBeTruthy();
    expect(canvas.getByRole('region', { name: 'New suggestion' })).toBeTruthy();
    expect(canvas.getAllByRole('button', { name: /Keep the old|Use the new|Keep both/ })).toHaveLength(3);
  },
};
