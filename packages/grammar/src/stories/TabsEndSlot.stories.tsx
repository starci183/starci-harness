import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import * as G from '../common/index.js';
import { Matrix, State } from './fixtures.js';

const meta: Meta = { title: 'Navigation & Data/Tabs end slot' };
export default meta;
type Story = StoryObj;

const regions: ReadonlyArray<G.TabItem> = [
  { id: 'all', label: 'All regions', count: 12 },
  { id: 'hanoi', label: 'Hanoi', count: 5 },
  { id: 'saigon', label: 'Ho Chi Minh City', count: 6 },
  { id: 'danang', label: 'Da Nang', count: 1 },
  { id: 'hue', label: 'Hue' },
  { id: 'cantho', label: 'Can Tho' },
];

const Strip = ({ kind, items = regions, id }: { readonly kind: 'views' | 'filter'; readonly items?: ReadonlyArray<G.TabItem>; readonly id: string }) => {
  const [selectedKey, setSelectedKey] = useState('all');
  return (
    <G.Tabs
      label={`${id} regions`}
      kind={kind}
      selectedKey={selectedKey}
      onSelect={setSelectedKey}
      items={items}
      end={<G.Button intent="alternative" size="sm">Add region</G.Button>}
    />
  );
};

const Rows = () => (
  <Matrix maxWidth={640}>
    <State label="Views strip: the command stands on the line, the line runs under it" direction="column"><Strip id="views" kind="views" /></State>
    <State label="Filter strip" direction="column"><Strip id="filter" kind="filter" items={regions.slice(0, 3)} /></State>
    <State label="Filter strip that folds: the end keeps its width" direction="column"><div style={{ maxWidth: 360 }}><Strip id="fold" kind="filter" /></div></State>
    <div dir="rtl"><State label="Right-to-left: the command ends the strip on the left" direction="column"><Strip id="rtl" kind="views" items={regions.slice(0, 3)} /></State></div>
  </Matrix>
);

/** Region tabs that carry a command at their end; the strip's separator spans the full column, under the command too. */
export const EndSlot: Story = { render: () => <Rows /> };
export const EndSlotDark: Story = { globals: { grammarTheme: 'dark' }, render: () => <Rows /> };
