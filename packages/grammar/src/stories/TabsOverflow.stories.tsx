import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import * as G from '../common/index.js';
import { Matrix, State } from './fixtures.js';

const meta: Meta = { title: 'Navigation & Data/Tabs overflow' };
export default meta;
type Story = StoryObj;

const destinations: ReadonlyArray<G.TabItem> = [
  { id: 'overview', label: 'Overview' },
  { id: 'conversations', label: 'Conversations' },
  { id: 'members', label: 'Members and invitations' },
  { id: 'resources', label: 'Learning resources' },
  { id: 'automations', label: 'Automations' },
  { id: 'settings', label: 'Channel settings' },
];

const Strip = ({ variant, overflow = true }: { readonly variant: 'primary' | 'secondary'; readonly overflow?: boolean }) => {
  const [selectedKey, setSelectedKey] = useState('overview');
  return <G.Tabs label={`${variant} destinations`} variant={variant} labelVisibility="always" scrollPreviousLabel="Scroll tabs left" scrollNextLabel="Scroll tabs right" selectedKey={selectedKey} onSelect={setSelectedKey} items={overflow ? destinations : destinations.slice(0, 2)} />;
};

/** Shared scroll-frame regression: directional controls, shadows, focus and vendor tab geometry. */
export const DirectionalOverflow: Story = {
  render: () => (
    <Matrix maxWidth={320}>
      <State label="Primary: overflow to the last destination" direction="column"><Strip variant="primary" /></State>
      <State label="Secondary: hover and selected pills keep their insets" direction="column"><Strip variant="secondary" /></State>
      <div dir="rtl"><State label="Right-to-left directional controls" direction="column"><Strip variant="secondary" /></State></div>
      <State label="Fits: no scroll caret" direction="column"><Strip variant="secondary" overflow={false} /></State>
    </Matrix>
  ),
};

const prompts = ['Summarize this lesson', 'Explain with examples', 'Quiz me', 'Suggest a learning plan', 'Review my answer', 'What should I study next?'];

const ChipsRows = () => (
  <Matrix maxWidth={320}>
    <State label="Quick prompts: scroll to either edge" direction="column">
      <G.HorizontalScrollRegion aria-label="Quick prompts" overflow="needed" isFocusable={false}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {prompts.map((prompt) => <G.Button key={prompt} variant="secondary" size="sm">{prompt}</G.Button>)}
        </div>
      </G.HorizontalScrollRegion>
    </State>
    <div dir="rtl">
      <State label="Right-to-left prompts" direction="column">
        <G.HorizontalScrollRegion aria-label="Right-to-left quick prompts" overflow="needed" isFocusable={false}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {prompts.map((prompt) => <G.Button key={prompt} variant="secondary" size="sm">{prompt}</G.Button>)}
          </div>
        </G.HorizontalScrollRegion>
      </State>
    </div>
    <State label="Fits: no carets" direction="column">
      <G.HorizontalScrollRegion aria-label="Short prompts" overflow="needed"><span>Quiz me</span></G.HorizontalScrollRegion>
    </State>
    <State label="Fades only: explicit opt-out" direction="column">
      <G.HorizontalScrollRegion aria-label="Prompts without carets" overflow="needed" carets={false}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>{prompts.map((prompt) => <span key={prompt}>{prompt}</span>)}</div>
      </G.HorizontalScrollRegion>
    </State>
  </Matrix>
);

export const ChipsLight: Story = { globals: { grammarTheme: 'light' }, render: () => <ChipsRows /> };
export const ChipsDark: Story = { globals: { grammarTheme: 'dark' }, render: () => <ChipsRows /> };
export const TabsDark: Story = { ...DirectionalOverflow, globals: { grammarTheme: 'dark' } };
