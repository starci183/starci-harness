import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * LESSON DIAGRAMS (0.55.1, owner 2026-11-23: "giờ hơi xấu"). Every Mermaid drawing wears the Grammar's own theme: participant and node
 * boxes rounded on the surface with a hairline edge, labels in the Grammar font at 12 / 16, muted dashed lifelines, foreground arrows with
 * clear heads, notes as soft tinted pills. A step marked danger is the faulty one, success the fix, accent a part the change touches.
 * Each story draws light and dark side by side.
 */
const meta: Meta = { title: 'Content/Lesson diagrams (0.55.1)', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

/** Light and dark halves of one diagram, each in its own scoped theme. */
const Both = ({ children }: { readonly children: React.ReactNode }) => (
  <div style={{ display: 'grid', gap: 24, maxInlineSize: 820 }}>
    <div className="light" style={{ background: 'var(--background)', padding: 16 }}>{children}</div>
    <div className="dark" style={{ background: 'var(--background)', padding: 16 }}>{children}</div>
  </div>
);

const RACE = `sequenceDiagram
  participant R as Lượt đọc chậm
  participant C as Redis
  participant D as Sổ giá
  participant M as Marketing
  R->>C: Hỏi giá: trống
  R->>D: Đọc giá: 249.000đ
  M->>D: Ghi 199.000đ
  M->>C: Xóa giá cũ
  R->>C: Ghi 249.000đ (sau lệnh xóa)
  Note over C: Giá cũ sống tới hết TTL 30 giây`;

/** A sequence: the fifth message is the faulty step (`messageTones`), a note under it as a soft pill, a caption under the drawing. */
export const Sequence: Story = {
  render: () => (
    <Both>
      <G.MermaidDiagram
        source={RACE}
        label="Lượt đọc chậm ghi giá cũ vào Redis sau lệnh xóa"
        height="md"
        messageTones={{ 5: 'danger' }}
        caption="Nhìn bước đỏ: lượt đọc chậm ghi giá cũ vào Redis sau lệnh xóa."
      />
    </Both>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(canvasElement.querySelectorAll('[data-grammar-mermaid-message-tone="danger"]').length).toBeGreaterThan(0);
    }, { timeout: 8000 });
  },
};

/** The same sequence in a phone-wide frame: a numbered list of its messages, the faulty one in the danger tone. */
export const SequenceOnPhone: Story = {
  render: () => (
    <div style={{ inlineSize: 360 }}>
      <G.MermaidDiagram source={RACE} label="Lượt đọc chậm ghi giá cũ" messageTones={{ 5: 'danger' }} caption="Bước 5 là chỗ hỏng." />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const steps = canvasElement.querySelectorAll('[data-grammar-mermaid-steps="true"] > li');
      expect(steps).toHaveLength(5);
      expect(steps[4]?.getAttribute('data-grammar-mermaid-tone')).toBe('danger');
    }, { timeout: 8000 });
  },
};

const FIX_LR = `flowchart LR
  A[Đọc sổ giá] --> B{Version mới hơn?}
  B -- có --> C[Ghi vào Redis]
  B -- không --> D[Bỏ bản cũ]
  class B accent
  class C success`;

/** A flowchart drawn across: a decision touched by the change (accent), the fix (success), labelled edges. */
export const FlowchartAcross: Story = {
  render: () => (
    <Both>
      <G.MermaidDiagram source={FIX_LR} label="Ghi cache theo version" caption="Cache từ chối bản cũ hơn bản đang giữ." />
    </Both>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(canvasElement.querySelectorAll('[data-grammar-mermaid-tone="accent"]').length).toBeGreaterThan(0);
      expect(canvasElement.querySelectorAll('[data-grammar-mermaid-tone="success"]').length).toBeGreaterThan(0);
    }, { timeout: 8000 });
  },
};

const ASIDE_TB = `flowchart TB
  U[Khách mở trang] --> G[GET giá trong Redis]
  G -->|trượt| S[SELECT từ Postgres]
  S --> W[SET với TTL 30 giây]
  G -->|trúng| R[Trả giá]
  W --> R`;

/** A flowchart drawn down, the faulty step by the `tones` map (its node id). */
export const FlowchartDown: Story = {
  render: () => (
    <Both>
      <G.MermaidDiagram source={ASIDE_TB} label="Cache-aside" height="lg" tones={{ W: 'danger' }} caption="Bước SET có thể đến sau lệnh xóa." />
    </Both>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelectorAll('[data-grammar-mermaid-tone="danger"]').length).toBeGreaterThan(0), { timeout: 8000 });
  },
};

const STATES = `stateDiagram-v2
  [*] --> Trong
  Trong --> Co: SET
  Co --> Trong: DEL
  Co --> Cu: ghi đè muộn
  Cu --> Trong: hết TTL
  class Cu danger`;

/** A state diagram: rounded states on the surface, the stale state in the danger tone by `class Cu danger`. */
export const StateDiagram: Story = {
  render: () => (
    <Both>
      <G.MermaidDiagram source={STATES} label="Vòng đời của key giá" height="md" caption="Trạng thái đỏ là giá cũ đã đè lên giá mới." />
    </Both>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelectorAll('[data-grammar-mermaid-tone="danger"]').length).toBeGreaterThan(0), { timeout: 8000 });
  },
};
