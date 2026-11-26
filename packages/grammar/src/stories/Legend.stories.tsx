import type { Meta, StoryObj } from '@storybook/react-vite';
import * as G from '../common/index.js';
import { Matrix, State } from './fixtures.js';

/**
 * Legend: a one-line key that maps each tone to its words. Each story draws a state.
 * The words are generic (a status of any record); nothing here is a product word.
 */
const meta: Meta = { title: 'Navigation & Data/Legend', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

const statuses: readonly G.LegendItem[] = [
  { id: 'planned', label: 'Planned', tone: 'neutral' },
  { id: 'active', label: 'In progress', tone: 'accent' },
  { id: 'done', label: 'Done', tone: 'success' },
  { id: 'risk', label: 'At risk', tone: 'warning' },
  { id: 'late', label: 'Late', tone: 'danger' },
  { id: 'milestone', label: 'Milestone', tone: 'accent', form: 'milestone' },
];

/** Every tone and the milestone form; each item reads its label, and the marks keep one size. */
export const LegendTones: Story = {
  render: () => (
    <Matrix>
      <State label="Five tones and a milestone" direction="column">
        <G.Legend label="Status colours" items={statuses} />
      </State>
      <State label="Two keys" direction="column">
        <G.Legend label="Plan colours" items={statuses.slice(0, 2)} />
      </State>
    </Matrix>
  ),
};

/** In a narrow column the key wraps onto more lines instead of scrolling or clipping; wide, one line. */
export const LegendWraps: Story = {
  render: () => (
    <Matrix>
      <State label="In a 15rem column (wraps)" direction="column">
        <div style={{ maxWidth: '15rem' }}><G.Legend label="Status colours" items={statuses} /></div>
      </State>
      <State label="In a 60rem column (one line)" direction="column">
        <div style={{ maxWidth: '60rem' }}><G.Legend label="Status colours" items={statuses} /></div>
      </State>
    </Matrix>
  ),
};

/** Loading keeps the words it was given and shimmers the marks; with none given, three placeholders; no keys draws nothing. */
export const LegendStates: Story = {
  render: () => (
    <Matrix>
      <State label="Ready" direction="column"><G.Legend label="Status colours" items={statuses.slice(0, 3)} /></State>
      <State label="Loading (labels kept)" direction="column"><G.Legend label="Status colours" items={statuses.slice(0, 3)} isLoading /></State>
      <State label="Loading (no keys yet)" direction="column"><G.Legend label="Status colours" items={[]} isLoading /></State>
      <State label="No keys (draws nothing)" direction="column"><G.Legend label="Status colours" items={[]} /></State>
    </Matrix>
  ),
};
