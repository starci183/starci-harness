import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * THE LAYOUT AND RESPONSIVE LAW. A page declares one frame type with `Page layout`. Every breakpoint belongs to Grammar (desktop from
 * 1280, tablet 768 to 1279, phone below 768); an app writes no media query. Resize the canvas (or use the viewport toolbar) to see each tier:
 * the page inset steps 32, 24, 12 (16 once the spacing scale has the step), a report keeps its cards in one column, a workspace grid shows one pane at a time on a phone.
 */
const meta: Meta = {
  title: 'Compositions/Page layouts',
  parameters: { grammar: { bleed: true } },
};
export default meta;
type Story = StoryObj;

const Card = ({ label }: { readonly label: string }) => (
  <G.SurfaceCard label={label}><G.Text>Cards of a report stack in one vertical column.</G.Text></G.SurfaceCard>
);

/** A: the report page. Pink well, one column of cards 24 apart (12 on a phone), page inset 32 / 24 / 12, content width at most 1280. */
export const ReportPage: Story = {
  render: () => (
    <G.Page layout="report" header={{ title: 'Overview' }}>
      <G.Stack gap="section">
        <Card label="Key figures" />
        <Card label="Recent runs" />
        <Card label="Connections" />
      </G.Stack>
    </G.Page>
  ),
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('[data-grammar-page-layout="report"]')).toBeTruthy();
    expect(within(canvasElement).getByText('Recent runs')).toBeTruthy();
  },
};

/** B: the workspace page. A selection pane, the main pane and an aside split by dividers; a phone shows one pane at a time. */
export const WorkspacePage: Story = {
  render: () => (
    <G.Page chrome="panes" layout="workspace" header={{ title: 'Runs' }}>
      <G.PaneGrid label="Runs workspace" areas={['list main aside']}>
        <G.Pane area="list" label="Workflows" surface><G.PaneSection><G.Text>Selection pane</G.Text></G.PaneSection></G.Pane>
        <G.Pane area="main" label="Run" surface><G.PaneSection><G.Text>Main pane</G.Text></G.PaneSection></G.Pane>
        <G.Pane area="aside" label="Details" surface><G.PaneSection><G.Text>Aside</G.Text></G.PaneSection></G.Pane>
      </G.PaneGrid>
    </G.Page>
  ),
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('[data-grammar-page-layout="workspace"]')).toBeTruthy();
  },
};
