import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import * as G from '../common/index.js';
import { Matrix, State } from './fixtures.js';

/*
 * Avatar initials, the AI Chip after a name (AgentName), the group of round marks and people, and the message hover rail (Grammar 0.55.0). The copy here is a story's own; in an app it
 * comes from its i18n: Grammar writes no sentence.
 */
const meta: Meta = { title: 'Navigation & Data/Avatar initials and message actions' };
export default meta;

type Story = StoryObj;

const names = ['Nguyễn Văn An', 'Đỗ Thị Hoa', 'Lê Quang Đạt', 'Trần Bình', 'Phạm Mai', 'Vũ Lan', 'Hồ Tâm', 'Claude', 'Ngô Ánh', 'Ế Minh'];
const overflowLabel = (count: number) => `${count} người khác`;
const describe = (shown: ReadonlyArray<string>, hidden: number) => `${shown.join(', ')}${hidden > 0 ? ` và ${hidden} người khác` : ''}`;
const group = (count: number): ReadonlyArray<G.AvatarGroupItem> => Array.from({ length: count }, (_, index) => ({ id: `m${index}`, name: names[index % names.length] ?? 'An' }));

/** Two letters (family name first, given name last; diacritics kept) on a colour the name always gets from Grammar's tone palette; an image wins. */
export const Initials: Story = {
  render: () => (
    <Matrix>
      <State label="Names: first letter of the first word plus the last word's (Nguyen Van An is NA), one word gives two letters">
        {names.map((name) => <G.Avatar key={name} name={name} />)}
      </State>
      <State label="The two sizes: sm 24 (the icon size) and md 40 (the common size)">
        {(['sm', 'md'] as const).map((size) => <G.Avatar key={size} name={names[0] ?? ''} size={size} />)}
      </State>
      <State label="An agent's avatar is initials only, like a person's; its AI Chip follows the NAME (AgentName: the name, then a small neutral Chip; the word is the app's)">
        {(['sm', 'md'] as const).map((size) => <G.Avatar key={size} name="Claude" kind="agent" size={size} />)}
        <G.AgentName isAgent name="Sales AI" />
        <G.AgentName isAgent agentLabel="Bot" name="Trợ lý bán hàng" />
        <G.AgentName name="Lan Anh" />
      </State>
      <State label="Loading is a skeleton circle">
        <G.Avatar name="Lan Anh" isLoading />
      </State>
    </Matrix>
  ),
};

/** Up to four members tiled in one avatar-sized circle: 1 fills, 2 are halves, 3 are a half over two quarters, 4 are quarters, 5 and more end in +N. */
export const ZaloGroup: Story = {
  render: () => (
    <Matrix>
      <State label="1, 2, 3, 4, 5, 8 members; the group is named from the members (A, B, C and 2 more)">
        {[1, 2, 3, 4, 5, 8].map((count) => <G.AvatarGroup key={count} label={`Nhóm ${count} người`} describe={describe} layout="grid" items={group(count)} overflowLabel={overflowLabel} />)}
      </State>
      <State label="Sizes sm and md; an agent among the members is initials like the others">
        {(['sm', 'md'] as const).map((size) => <G.AvatarGroup key={size} label="Nhóm" layout="grid" size={size} items={[...group(3), { id: 'bot', name: 'Claude', kind: 'agent' as const }]} overflowLabel={overflowLabel} />)}
      </State>
    </Matrix>
  ),
};

const MailGlyph = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 6h18v12H3zM3 7l9 6 9-6" /></svg>;
const ChatGlyph = () => <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 4h16v12H8l-4 4z" /></svg>;
const channels: ReadonlyArray<G.AvatarGroupItem> = [
  { id: 'zalo', name: 'Zalo', mark: { logo: <ChatGlyph />, color: '#0068ff', ink: '#ffffff' } },
  { id: 'mail', name: 'Email', mark: { logo: <MailGlyph /> } },
  { id: 'facebook', name: 'Facebook', mark: { logo: <ChatGlyph />, color: '#1877f2', ink: '#ffffff' }, tone: 'danger' },
  { id: 'an', name: 'Nguyễn Văn An' },
  { id: 'hoa', name: 'Đỗ Thị Hoa' },
  { id: 'ai', name: 'Trợ lý bán hàng', kind: 'agent' },
  { id: 'tg', name: 'Telegram', mark: { logo: <ChatGlyph />, tone: 'strong' } },
];

/** People and marks (the app's provider or channel logos on a round plate, never initials) in one round group: a row overlaps, a grid tiles; past max - 1 the rest is "+N"; tone="danger" rings a broken account. */
export const RoundMarks: Story = {
  render: () => (
    <Matrix>
      <State label="Row: 3 items, then 5 with max 4 (three and +2), then 7 with max 6 (five and +2); the third is a broken account (danger ring)">
        <G.AvatarGroup label="Kênh" items={channels.slice(0, 3)} overflowLabel={overflowLabel} />
        <G.AvatarGroup label="Kênh" items={channels.slice(0, 5)} overflowLabel={overflowLabel} />
        <G.AvatarGroup label="Kênh" items={channels} max={6} overflowLabel={overflowLabel} />
      </State>
      <State label="Grid: marks and people in one round identity; hover, focus or a tap opens the member list">
        <G.AvatarGroup label="Kênh" layout="grid" items={channels.slice(0, 2)} overflowLabel={overflowLabel} />
        <G.AvatarGroup label="Kênh" layout="grid" items={channels.slice(0, 4)} overflowLabel={overflowLabel} />
        <G.AvatarGroup label="Kênh" layout="grid" items={channels} overflowLabel={overflowLabel} />
      </State>
      <State label="One mark on its own: the app's logo (a placeholder here; Grammar ships no brand logos) on a token plate and on a brand colour; no logo is the generic channel glyph, never initials">
        <G.Avatar name="Email" mark={{ logo: <MailGlyph /> }} />
        <G.Avatar name="Zalo" mark={{ logo: <ChatGlyph />, color: '#0068ff', ink: '#ffffff' }} tone="danger" />
        <G.Avatar name="Kênh khác" mark={{}} />
      </State>
      <State label="sm 24 (inline, a summary, the providers on an agent card) and md 40 (a row lead): the +N is always the muted pair">
        <G.AvatarGroup label="Kênh" size="sm" items={channels} overflowLabel={overflowLabel} />
        <G.AvatarGroup label="Kênh" size="md" items={channels} overflowLabel={overflowLabel} />
      </State>
    </Matrix>
  ),
};

const labels: G.MessageActionsLabels = {
  react: 'Bày tỏ cảm xúc',
  reply: 'Trả lời',
  more: 'Thêm',
  picker: 'Chọn cảm xúc',
  reactWith: (emoji) => `Bày tỏ ${emoji}`,
  allEmoji: 'Tất cả cảm xúc',
};

const ChatDemo = () => {
  const [mine, setMine] = useState<string | undefined>('👍');
  const [others, setOthers] = useState<string | undefined>(undefined);
  const menu = (own: boolean, agent: boolean): ReadonlyArray<G.DropdownMenuEntry> => [
    { id: 'copy', label: 'Sao chép' },
    { id: 'pin', label: 'Ghim tin nhắn' },
    ...(own ? [{ id: 'recall', label: 'Thu hồi', tone: 'danger' as const }] : []),
    ...(agent ? [{ id: 'task', label: 'Tạo việc từ tin này' }] : []),
  ];
  const reactions = (emoji: string | undefined) => (emoji === undefined ? [] : [{ emoji, count: 1, mine: true }]);
  return (
    <div style={{ display: 'grid', gap: '1.5rem', padding: '4rem 4rem 2rem' }}>
      <G.MessageBubble author="Nguyễn Văn An" avatar={<G.Avatar name="Nguyễn Văn An" isDecorative />} body="Hover the bubble, press Tab, or long-press on touch: the rail appears on the right."
        reactions={reactions(others)} messageActions={{ labels, onReact: setOthers, onReply: () => undefined, onMore: () => undefined, menu: menu(false, false), ...(others === undefined ? {} : { reaction: others }) }} />
      <G.MessageBubble side="outgoing" body="My own message: the rail is on the left, the picker opens over the bubble to the right."
        reactions={reactions(mine)} messageActions={{ labels, onReact: setMine, onReply: () => undefined, onMore: () => undefined, menu: menu(true, false), ...(mine === undefined ? {} : { reaction: mine }) }} />
      <G.MessageBubble author="Claude" isAgent avatar={<G.Avatar name="Claude" kind="agent" isDecorative />} body="An agent's message: on the right, with Create a task from this message in the menu."
        messageActions={{ labels, onReact: () => undefined, onReply: () => undefined, menu: menu(false, true) }} />
    </div>
  );
};

/** The hover rail: react, reply and more as HeroUI ghost sm icon buttons, the floating picker above react, the app's menu. Engine cards do not use it. */
const team: ReadonlyArray<G.AvatarGroupItem> = [
  { id: 'an', name: 'Nguyễn Văn An' },
  { id: 'hoa', name: 'Đỗ Thị Hoa' },
  { id: 'sales', name: 'Trợ lý bán hàng', kind: 'agent' },
  { id: 'dat', name: 'Lê Quang Đạt' },
  { id: 'care', name: 'Chăm sóc khách', kind: 'agent', seed: 'agent-care' },
  { id: 'binh', name: 'Trần Bình' },
];

/**
 * The group shows alone (no names beside it): `max` slots, then "+N". Hover, focus (Tab) or a tap opens the list of every member: the 24px avatar, the name and,
 * for an agent, the small "AI" Chip. `sm` 24 is the icon size (inline beside a label), `md` 40 the common size (a header, a list lead).
 */
export const MemberList: Story = {
  render: () => (
    <Matrix>
      <State label="sm 24, inline beside a label: 6 members (3 people, 2 agents) with max 4">
        <G.Text role="label.item">Nhóm phụ trách</G.Text>
        <G.AvatarGroup label="Nhóm phụ trách" items={team} size="sm" overflowLabel={overflowLabel} />
      </State>
      <State label="md 40, standalone in a header: the same 6 members">
        <G.AvatarGroup label="Nhóm phụ trách" items={team} size="md" overflowLabel={overflowLabel} />
      </State>
      <State label="Opened by default (the shot): md 40 with its member list">
        <G.AvatarGroup label="Nhóm phụ trách" items={team} size="md" overflowLabel={overflowLabel} />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    const triggers = canvasElement.querySelectorAll<HTMLElement>('[data-grammar-avatar-group-trigger]');
    triggers[triggers.length - 1]?.focus();
  },
};

export const MessageActionsRail: Story = { render: () => <ChatDemo /> };
