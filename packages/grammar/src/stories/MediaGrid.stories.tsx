import type { Meta, StoryObj } from '@storybook/react-vite';
import * as G from '../common/index.js';
import { Matrix, State, noop } from './fixtures.js';

/** The files of a collection: a grid of previews or a list of hairline rows, each linking back to the record that uses it. */
const meta: Meta = { title: 'MediaGrid' };
export default meta;
type Story = StoryObj;

const PICTURE = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#c9d6c4"/><circle cx="200" cy="170" r="80" fill="#e8b4a0"/></svg>');

const items: ReadonlyArray<G.MediaItem> = [
  { id: 'a', kind: 'image', name: 'goi-dau-thao-duoc.jpg', src: PICTURE, meta: '412 KB · 1080 × 1080', source: { label: 'Dịch vụ · Gội đầu thảo dược', href: '#a' } },
  { id: 'b', kind: 'video', name: 'reel-cham-soc-da.mp4', src: null, meta: '18,2 MB · 0:32', source: { label: 'Bài đăng · Reel tháng 11', href: '#b' } },
  { id: 'c', kind: 'audio', name: 'loi-chao.mp3', src: null, meta: '640 KB · 0:41' },
  { id: 'd', kind: 'document', name: 'bang-gia-2026.pdf', src: null, meta: '1,1 MB', badge: { label: 'Không thuộc object nào' } },
];

/** Grid and list, selected, loading and empty. */
export const MediaGridStates: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="Grid" direction="column"><G.MediaGrid label="Tệp của workspace" items={items} onOpen={noop} empty="Chưa có tệp" /></State>
      <State label="List, one selected" direction="column"><G.MediaGrid label="Tệp của workspace" layout="list" selectedId="b" items={items} onOpen={noop} empty="Chưa có tệp" /></State>
      <State label="Loading" direction="column"><G.MediaGrid label="Tệp của workspace" items={[]} isLoading empty="Chưa có tệp" /></State>
      <State label="Empty" direction="column"><G.MediaGrid label="Tệp của workspace" items={[]} empty={<G.Text tone="muted">Chưa có tệp</G.Text>} /></State>
    </Matrix>
  ),
};
