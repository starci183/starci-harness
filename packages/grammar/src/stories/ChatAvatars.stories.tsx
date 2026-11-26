import type { Meta, StoryObj } from '@storybook/react-vite';
import * as G from '../common/index.js';
import { Matrix, State, placeholderImage } from './fixtures.js';

/**
 * THE CHAT AVATARS (0.60.0, owner 2026-11-26, NIVO feedback 5, 6, 7). Every circle avatar is a true circle at 24 and 40. A group is NOT one big circle cut into tiles:
 * it is small round member avatars set close in a 2 by 2 cluster, the way Zalo draws it (two on the diagonal, three as two over one, four or more as three members
 * and a count cell that reads the number of members); a group photo replaces the cluster. A customer's avatar carries a small channel badge in its corner.
 */
const meta: Meta = { title: 'Navigation & Data/Chat avatars' };
export default meta;
type Story = StoryObj;

const people: ReadonlyArray<G.AvatarGroupItem> = [
  { id: 'lan', name: 'Lan Nguyễn' },
  { id: 'mai', name: 'Mai Trần', src: placeholderImage('M', 160) },
  { id: 'bao', name: 'Quốc Bảo' },
  { id: 'hoa', name: 'Thị Hoa' },
  { id: 'nam', name: 'Hoàng Nam' },
  ...Array.from({ length: 24 }, (_, index) => ({ id: `m-${index}`, name: `Thành viên ${index + 6}` })),
];

const overflowLabel = (count: number) => `${count} người khác`;

/** Every shape of the cluster at both sizes: 1, 2 (diagonal), 3 (two over one), 4, 5, 7 and 29 members, and a group photo. */
export const GroupCluster: Story = {
  render: () => (
    <Matrix>
      {(['md', 'sm'] as const).map((size) => (
        <State key={size} label={`Cụm nhóm ${size === 'md' ? '40' : '24'}: 1, 2, 3, 4, 5, 7, 29 thành viên, rồi ảnh nhóm`}>
          {[1, 2, 3, 4, 5, 7, 29].map((count) => <G.AvatarGroup key={count} label={`Nhóm ${count} người`} layout="grid" size={size} items={people.slice(0, count)} overflowLabel={overflowLabel} />)}
          <G.AvatarGroup label="Nhóm có ảnh" layout="grid" size={size} photo={placeholderImage('N', 200)} items={people.slice(0, 5)} overflowLabel={overflowLabel} />
        </State>
      ))}
      <State label="Không thành viên: chữ cái của tên nhóm; tên nhóm 'Lễ Tân'">
        <G.AvatarGroup label="Lễ Tân" layout="grid" items={[]} overflowLabel={overflowLabel} />
        <G.Avatar name="Lễ Tân" />
      </State>
    </Matrix>
  ),
};

/** The group photo wins over the members: one round image, the cluster gone. */
export const GroupPhoto: Story = {
  render: () => (
    <Matrix>
      <State label="Ảnh nhóm 40 và 24, cạnh avatar người">
        {(['md', 'sm'] as const).map((size) => (
          <G.AvatarGroup key={size} label="Nhóm Hiền Mai Spa" layout="grid" size={size} photo={placeholderImage('S', 40)} items={people.slice(0, 5)} overflowLabel={overflowLabel} />
        ))}
        <G.Avatar name="Lan Nguyễn" />
      </State>
    </Matrix>
  ),
};

const channels: ReadonlyArray<G.AvatarChannel> = ['messenger', 'instagram', 'facebook', 'zalo', 'whatsapp', 'telegram', 'tiktok', 'gmail', 'line', 'viber', 'wechat', 'x', 'youtube', 'discord', 'googlechat', 'email'];

/** A customer's avatar with its channel badge in the corner: initials and a photo, at 40 and 24, every channel. */
export const CustomerChannelBadge: Story = {
  render: () => (
    <Matrix>
      <State label="Mọi kênh, cỡ 40, chữ cái">
        {channels.map((channel, index) => <G.Avatar key={channel} name={`Khách ${index + 1}`} channel={channel} />)}
      </State>
      <State label="Ảnh khách và chữ cái, 40 và 24, Zalo, Messenger, email">
        {(['md', 'sm'] as const).flatMap((size) => [
          <G.Avatar key={`${size}-z`} name="Mai Phương" size={size} channel="zalo" channelLabel="Tin nhắn Zalo" src={placeholderImage('M', 330)} />,
          <G.Avatar key={`${size}-m`} name="Quốc Bảo" size={size} channel="messenger" />,
          <G.Avatar key={`${size}-e`} name="Lan Anh" size={size} channel="email" channelLabel="Thư điện tử" />,
        ])}
      </State>
    </Matrix>
  ),
};

/** Every circle avatar is a true circle at 24 and 40: initials, photo, mark and a lone logo, named or not, alone and in a flex row that would squeeze it. */
export const AvatarsAreRound: Story = {
  render: () => (
    <Matrix>
      {(['md', 'sm'] as const).map((size) => (
        <State key={size} label={`Avatar tròn, cỡ ${size === 'md' ? '40' : '24'}`}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, inlineSize: 180 }}>
            <G.Avatar name="Lễ Tân" size={size} />
            <G.Avatar name="Lan Nguyễn" size={size} src={placeholderImage('L', 120)} />
            <G.Avatar name="Zalo" size={size} mark={{ color: '#0068ff', ink: '#fff' }} />
            <G.Avatar name="NIVO" size={size} tone="solid" />
            <G.Avatar name="Chung" size={size} tone="danger" />
            <G.Avatar name="Claude" kind="agent" size={size} />
          </div>
        </State>
      ))}
    </Matrix>
  ),
};
