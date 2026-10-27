import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import * as G from '../common/index.js';
import { Matrix, State, placeholderImage } from './fixtures.js';

const meta: Meta = { title: 'Navigation & Data/Group Identity' };
export default meta;

type Story = StoryObj;

const members: ReadonlyArray<G.AvatarGroupItem> = [
  { id: 'alex', name: 'Alex Morgan', src: placeholderImage('A', 40) },
  { id: 'sam', name: 'Sam Lee', src: placeholderImage('S', 160) },
  { id: 'robin', name: 'Robin Park', seed: 'user-robin', kind: 'agent' },
  { id: 'jordan', name: 'Jordan Kim', seed: 'user-jordan', src: placeholderImage('J', 290) },
  { id: 'taylor', name: 'Taylor Fox' },
  { id: 'casey', name: 'Casey Wu' },
];

const overflowLabel = (count: number) => `${count} more members`;
const thirtyMembers: ReadonlyArray<G.AvatarGroupItem> = [
  ...members,
  ...Array.from({ length: 24 }, (_, index) => ({ id: `member-${index}`, name: `Member ${index + 7}` })),
];

/** One group identity remains the size of its adjacent person avatar at every supported size. */
export const Grid: Story = {
  render: () => (
    <Matrix>
      <State label="One, two (split), three (one above two), four and total counts 5, 6 and 30">
        {[1, 2, 3, 4, 5, 6, 30].map((count) => <G.AvatarGroup key={count} label={`Conversation with ${count} members`} layout="grid" items={thirtyMembers.slice(0, count)} overflowLabel={overflowLabel} />)}
      </State>
      <State label="Same sizes as Avatar: small, medium, large and control">
        {(['sm', 'md', 'lg', 'control'] as const).map((size) => (
          <React.Fragment key={size}>
            <G.Avatar name="Alex Morgan" src={placeholderImage('A', 40)} size={size} />
            <G.AvatarGroup label={`Study group (${size})`} layout="grid" size={size} items={members} overflowLabel={overflowLabel} />
          </React.Fragment>
        ))}
      </State>
      <State label="DiceBear initials and failed-image fallback use Avatar's same parts">
        <G.AvatarGroup label="Study partners" layout="grid" items={[{ id: 'alex', name: 'Alex Morgan' }, { id: 'sam', name: 'Sam Lee', src: 'data:image/png;base64,broken' }, { id: 'robin', name: 'Robin Park', fallback: 'RP' }]} overflowLabel={overflowLabel} />
      </State>
      <State label="Seeded initials, uploaded src wins, and free-text agents in both layouts">
        {(['row', 'grid'] as const).map((layout) => <G.AvatarGroup key={layout} label={`Identity sources (${layout})`} layout={layout} items={[
          { id: 'alex', name: 'Alex Morgan', seed: 'user-alex' },
          { id: 'sam', name: 'Sam Lee', seed: 'user-sam', src: placeholderImage('S', 160) },
          { id: 'robin', name: 'Th\u1ea3o V\u00e2n Mkt', kind: 'agent' },
        ]} overflowLabel={overflowLabel} />)}
      </State>
      <State label="Empty member data uses the named group's DiceBear initials">
        <G.AvatarGroup label="Study group" layout="grid" items={[]} overflowLabel={overflowLabel} />
      </State>
      <State label="The member row still stacks and supports control size">
        <G.AvatarGroup label="Study group members" size="control" items={members} max={4} overflowLabel={overflowLabel} />
      </State>
    </Matrix>
  ),
};
