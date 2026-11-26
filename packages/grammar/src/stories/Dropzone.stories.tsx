import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Dropzone, type DropzoneFile, type DropzoneItem, type DropzoneLabels } from '../core/ext/dropzone/index.js';
import { DropzoneView, type DropzoneViewProps } from '../core/ext/dropzone/DropzoneView.js';
import { DEFAULT_DROPZONE_LABELS, resolveDropzoneLabels } from '../core/ext/dropzone/labels.js';
import { Matrix, State } from './fixtures.js';

/**
 * The upload extension (`@starci/grammar/core/ext/dropzone`): one Dropzone for every upload, its states (idle, drag-over, rejected,
 * loading) and the rows of the app's uploads. The words are the ones an app passes in `labels` (here Vietnamese, as an app would);
 * the drawing comes from Grammar tokens only, at 1440 and 390.
 */
const meta: Meta = { title: 'Forms/Dropzone', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

const vi: Partial<DropzoneLabels> = {
  title: 'Kéo thả tệp hoặc thư mục vào đây',
  acceptedTypes: (types, maxSize) => `${types.length === 0 ? 'Mọi loại tệp' : types.join(', ')}${maxSize === undefined ? '' : `, tối đa ${maxSize} mỗi tệp`}`,
  chooseFiles: 'Chọn tệp',
  chooseFolder: 'Chọn thư mục',
  dropTo: (target) => `Thả để tải lên ${target ?? ''}`.trim(),
  dragged: (count) => `${count} mục đang kéo`,
  rejectedTitle: 'Một số tệp chưa được thêm',
  rejected: (reason, count, { maxSize, maxFiles }) =>
    reason === 'too-large' ? `${count} tệp quá lớn (tối đa ${maxSize ?? ''}).` : reason === 'wrong-type' ? `${count} tệp sai loại.` : `Quá nhiều tệp: tối đa ${maxFiles ?? 1} tệp mỗi lần.`,
  done: 'Xong',
  waiting: 'Chờ',
  error: 'Lỗi',
  retry: 'Thử lại',
  progressOf: (name) => `Tiến độ tải ${name}`,
  listLabel: 'Tệp đang tải',
  summary: ({ done, uploading, waiting, error }) => `${done} xong, ${uploading} đang tải, ${waiting} chờ, ${error} lỗi`,
};
const labels = resolveDropzoneLabels(vi);

const base: DropzoneViewProps = {
  phase: 'idle',
  labels,
  target: 'Hồ sơ khách hàng',
  acceptedTypes: ['PNG', 'JPG', 'PDF'],
  limits: { maxSize: '10 MB', maxFiles: 20 },
  draggedCount: 0,
  rejections: [],
  items: [],
  folders: true,
  isDisabled: false,
  onRetry: undefined,
  onChooseFiles: () => undefined,
  onChooseFolder: () => undefined,
};

const uploads: readonly DropzoneItem[] = [
  { id: '1', name: 'hop-dong/hop-dong-2026.pdf', type: 'application/pdf', status: 'done' },
  { id: '2', name: 'anh/mat-truoc-cccd.jpg', type: 'image/jpeg', status: 'uploading', progress: 64 },
  { id: '3', name: 'bang-gia.xlsx', status: 'waiting' },
  { id: '4', name: 'video-gioi-thieu.mp4', type: 'video/mp4', status: 'error', progress: 38 },
];

/** Idle, drag-over and rejected, as the zone draws them. */
export const States: Story = {
  render: () => (
    <Matrix maxWidth={640}>
      <State label="Idle" direction="column"><DropzoneView {...base} /></State>
      <State label="Drag-over" direction="column"><DropzoneView {...base} phase="over" draggedCount={3} /></State>
      <State label="Rejected" direction="column">
        <DropzoneView {...base} phase="rejected" rejections={[{ reason: 'too-large', count: 2 }, { reason: 'wrong-type', count: 1 }]} />
      </State>
    </Matrix>
  ),
};

/** The rows of the app's uploads: done, uploading with its percent, waiting, and failed with its retry. */
export const Uploads: Story = {
  render: () => (
    <Matrix maxWidth={640}>
      <State label="Rows" direction="column"><DropzoneView {...base} items={uploads} onRetry={() => undefined} /></State>
    </Matrix>
  ),
};

/** Loading: the zone and its rows as Skeletons at the ready box (also what shows while react-dropzone loads). */
export const Loading: Story = {
  render: () => (
    <Matrix maxWidth={640}>
      <State label="Loading" direction="column"><Dropzone onFiles={() => undefined} items={uploads} isLoading /></State>
    </Matrix>
  ),
};

/** The live zone: drop or pick files and folders; the story plays the app's part and moves each file to done. */
export const Live: Story = {
  render: function Live() {
    const [items, setItems] = useState<readonly DropzoneItem[]>([]);
    const onFiles = (files: DropzoneFile[]) =>
      setItems((current) => [...current, ...files.map(({ path, file }, index): DropzoneItem => ({ id: `${Date.now()}-${index}`, name: path, type: file.type, status: 'done' }))]);
    return (
      <Matrix maxWidth={640}>
        <State label="Live" direction="column">
          <Dropzone onFiles={onFiles} items={items} accept={{ 'image/*': ['.png', '.jpg'], 'application/pdf': ['.pdf'] }} maxSize={10 * 1024 * 1024} target="Hồ sơ khách hàng" labels={vi} />
        </State>
        <State label="English defaults" direction="column">
          <Dropzone onFiles={() => undefined} labels={DEFAULT_DROPZONE_LABELS} />
        </State>
      </Matrix>
    );
  },
};
