import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import * as G from '../common/index.js';

const meta: Meta = { title: 'Compositions/Page sub tabs' };
export default meta;
type Story = StoryObj;

const pageTabs: ReadonlyArray<G.TabItem> = [
  { id: 'overview', label: 'Overview' },
  { id: 'channels', label: 'Channels' },
  { id: 'billing', label: 'Billing' },
];
const subTabs: ReadonlyArray<G.TabItem> = [
  { id: 'all', label: 'All regions' },
  { id: 'hanoi', label: 'Hanoi', count: 5 },
  { id: 'saigon', label: 'Ho Chi Minh City', count: 6 },
];

const Demo = () => {
  const [tab, setTab] = useState('channels');
  const [sub, setSub] = useState('all');
  return (
    <G.Page
      header={{
        title: 'Workspace',
        description: 'Channels by region.',
        actions: <G.Button intent="commit">Add channel</G.Button>,
        tabs: { label: 'Workspace views', items: pageTabs, selectedKey: tab, onSelect: setTab },
        subTabs: { label: 'Regions', items: subTabs, selectedKey: sub, onSelect: setSub, end: <G.Button intent="alternative" size="sm">Add region</G.Button> },
      }}
    >
      <G.Text>{`${pageTabs.find((item) => item.id === tab)?.label} / ${subTabs.find((item) => item.id === sub)?.label}`}</G.Text>
    </G.Page>
  );
};

/** Two underline rows in the white band: page tabs on their own full-width separator, region sub tabs under them on the band's border. */
export const SubTabs: Story = { render: () => <Demo /> };
export const SubTabsDark: Story = { globals: { grammarTheme: 'dark' }, render: () => <Demo /> };
