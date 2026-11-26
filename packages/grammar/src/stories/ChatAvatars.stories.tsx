import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
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

const near = (a: number, b: number, tolerance = 0.75) => Math.abs(a - b) <= tolerance;

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
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const clusters = [...canvasElement.querySelectorAll<HTMLElement>('.starci-core-avatar-cluster[data-grammar-avatar-size="md"]')];
      expect(clusters.length).toBeGreaterThanOrEqual(7);
      for (const cluster of clusters) {
        // Not one big circle: the cluster neither clips nor rounds itself, and it is the square of one Avatar.
        const style = getComputedStyle(cluster);
        expect(style.overflow).toBe('visible');
        expect(style.borderRadius).toBe('0px');
        const box = cluster.getBoundingClientRect();
        expect(near(box.width, 40)).toBe(true);
        expect(near(box.height, 40)).toBe(true);
        // Every member and the count cell is its own circle: square box, 50% radius.
        for (const cell of cluster.querySelectorAll<HTMLElement>('.starci-core-avatar-group-member, .starci-core-avatar-group-count')) {
          const rect = cell.getBoundingClientRect();
          expect(near(rect.width, rect.height, 0.5)).toBe(true);
          expect(getComputedStyle(cell).borderRadius).toBe('50%');
          // Inside the cluster's square.
          expect(rect.left).toBeGreaterThanOrEqual(box.left - 0.5);
          expect(rect.right).toBeLessThanOrEqual(box.right + 0.5);
          expect(rect.top).toBeGreaterThanOrEqual(box.top - 0.5);
          expect(rect.bottom).toBeLessThanOrEqual(box.bottom + 0.5);
        }
      }
      const slotsOf = (cluster: HTMLElement) => [...cluster.querySelectorAll<HTMLElement>('[data-grammar-cluster-slot]')].map((cell) => cell.getAttribute('data-grammar-cluster-slot'));
      expect(slotsOf(clusters[1]!)).toEqual(['top-start', 'bottom-end']);
      expect(slotsOf(clusters[2]!)).toEqual(['top-start', 'top-end', 'bottom-centre']);
      expect(slotsOf(clusters[3]!)).toEqual(['top-start', 'top-end', 'bottom-start', 'bottom-end']);
      // The count cell reads the headcount of the whole group.
      expect(clusters[4]!.querySelector('[data-grammar-avatar-count="true"]')?.textContent).toBe('5');
      expect(clusters[6]!.querySelector('[data-grammar-avatar-count="true"]')?.textContent).toBe('29');
      // Two members stand on the diagonal: the first top start, the second bottom end.
      const two = [...clusters[1]!.querySelectorAll<HTMLElement>('[data-grammar-cluster-slot]')].map((cell) => cell.getBoundingClientRect());
      expect(two[0]!.left).toBeLessThan(two[1]!.left);
      expect(two[0]!.top).toBeLessThan(two[1]!.top);
      // Three: the third is centred under the other two.
      const three = [...clusters[2]!.querySelectorAll<HTMLElement>('[data-grammar-cluster-slot]')].map((cell) => cell.getBoundingClientRect());
      expect(near((three[2]!.left + three[2]!.right) / 2, (clusters[2]!.getBoundingClientRect().left + clusters[2]!.getBoundingClientRect().right) / 2)).toBe(true);
      expect(three[2]!.top).toBeGreaterThan(three[0]!.top);
    });
  },
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
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const photos = [...canvasElement.querySelectorAll<HTMLElement>('[data-grammar-avatar-photo="true"]')];
      expect(photos).toHaveLength(2);
      for (const photo of photos) {
        expect(photo.querySelector('[data-grammar-cluster-slot]')).toBeNull();
        const avatar = photo.querySelector<HTMLElement>('.starci-core-avatar')!;
        const rect = avatar.getBoundingClientRect();
        expect(near(rect.width, rect.height, 0.5)).toBe(true);
        expect(getComputedStyle(avatar).borderRadius).toBe('50%');
      }
    });
  },
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
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const badged = [...canvasElement.querySelectorAll<HTMLElement>('.starci-core-avatar-badged')];
      expect(badged.length).toBe(channels.length + 6);
      for (const wrapper of badged) {
        const avatar = wrapper.querySelector<HTMLElement>('.starci-core-avatar')!;
        const badge = wrapper.querySelector<HTMLElement>('.starci-core-avatar-channel')!;
        const a = avatar.getBoundingClientRect();
        const b = badge.getBoundingClientRect();
        // The avatar stays a true circle and the badge is outside its clip, in the bottom end corner, round and smaller than the avatar.
        expect(near(a.width, a.height, 0.5)).toBe(true);
        expect(getComputedStyle(avatar).borderRadius).toBe('50%');
        expect(near(b.width, b.height, 0.5)).toBe(true);
        expect(getComputedStyle(badge).borderRadius).toBe('50%');
        expect(b.width).toBeLessThan(a.width * 0.6);
        expect(b.right).toBeGreaterThan(a.right - 1);
        expect(b.bottom).toBeGreaterThan(a.bottom - 1);
        expect(badge.getAttribute('role')).toBe('img');
        expect(badge.getAttribute('aria-label')).not.toBe('');
        expect(badge.querySelector('svg')).not.toBeNull();
      }
    });
  },
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
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const avatars = [...canvasElement.querySelectorAll<HTMLElement>('.starci-core-avatar')];
      expect(avatars).toHaveLength(12);
      for (const avatar of avatars) {
        const rect = avatar.getBoundingClientRect();
        const size = avatar.getAttribute('data-grammar-avatar-size') === 'md' ? 40 : 24;
        expect(near(rect.width, size, 0.5)).toBe(true);
        expect(near(rect.height, size, 0.5)).toBe(true);
        expect(getComputedStyle(avatar).borderRadius).toBe('50%');
      }
    });
  },
};
