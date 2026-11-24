import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * LESSON PAGE PARTS (0.55.1, owner 2026-11-23, StarCi Next lesson pages). The reading roles for a lesson's headline and prose, a standalone
 * CodeBlock (file, numbered excerpt, marked lines, note, fold, Copy, dark and light), a GradedChoice question, Sidenotes in the margin and
 * a sticky TableOfContents that follows the scroll.
 */
const meta: Meta = { title: 'Content/Lesson page parts (0.55.1)', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

/** reading.title over reading.body: the question and its story, beside the console's body role for scale. */
export const ReadingRoles: Story = {
  render: () => (
    <G.Stack gap="section">
      <G.Text as="p" role="reading.title">Marketing đã xóa giá cũ trong Redis sau khi ghi giá mới. Vì sao Redis vẫn giữ 249.000đ?</G.Text>
      <G.Text as="p" role="reading.body">Còn hai phút tới giờ sale, marketing đổi giá nồi chiên sớm để thử. Một khách mở trang nồi chiên; máy chủ web không thấy giá trong Redis nên đi đọc sổ giá: 249.000đ.</G.Text>
      <G.Text as="p" role="body">The console body (14 / 22), for comparison.</G.Text>
    </G.Stack>
  ),
  play: async ({ canvasElement }) => {
    const title = canvasElement.querySelector('[data-role="reading.title"]') as HTMLElement;
    const body = canvasElement.querySelector('[data-role="reading.body"]') as HTMLElement;
    const wide = window.innerWidth > 480;
    expect(getComputedStyle(title).fontSize).toBe(wide ? '28px' : '23px');
    expect(getComputedStyle(title).lineHeight).toBe(wide ? '38px' : '32px');
    expect(getComputedStyle(body).fontSize).toBe(wide ? '17px' : '16px');
    expect(getComputedStyle(body).lineHeight).toBe(wide ? '29px' : '27px');
  },
};

const EXCERPT = `export const getPrice = async (id: string) => {
  const cached = await redis.get(\`price:\${id}\`)
  if (cached !== null) return Number(cached)
  const { price } = await db.products.find(id)
  await sleep(600) // the slow read of the lesson
  await redis.set(\`price:\${id}\`, price, { EX: 30 })
  return price
}`;

const VI = { copy: 'Chép', copied: 'Đã chép', copyError: 'Không chép được', lines: (a: number, b: number) => `dòng ${a}–${b}`, marked: (n: number) => `${n} dòng đánh dấu` };

/** An excerpt numbered from line 64 as the file does, lines 67 and 69 marked, a note under it, the Copy command. */
export const CodeExcerpt: Story = {
  render: () => (
    <div style={{ maxInlineSize: 760 }}>
      <G.CodeBlock code={EXCERPT} language="ts" path="bugs/source/src/products.ts" start={64} highlightLines={[67, 69]} labels={VI}
        note="Bản lỗi: sau khi đọc sổ giá (dòng 67) còn một nhịp trước khi ghi cache (dòng 69)." />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const lines = canvasElement.querySelectorAll('.starci-core-code-line');
    expect(lines).toHaveLength(8);
    expect(lines[0]?.getAttribute('data-line')).toBe('64');
    expect([...lines].filter((line) => line.getAttribute('data-grammar-line-highlighted') === 'true').map((line) => line.getAttribute('data-line'))).toEqual(['67', '69']);
    expect(within(canvasElement).getByRole('button', { name: 'Chép' })).toBeTruthy();
  },
};

/** Folded to one row: the file, "dòng 64–71 · 2 dòng đánh dấu", the badge; a press opens it. */
export const CodeFolded: Story = {
  render: () => (
    <div style={{ maxInlineSize: 760 }}>
      <G.CodeBlock code={EXCERPT} language="ts" path="bugs/source/src/products.ts" start={64} highlightLines={[67, 69]} labels={VI} defaultCollapsed />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const fold = within(canvasElement).getByRole('button', { expanded: false });
    expect(fold.textContent).toContain('dòng 64–71 · 2 dòng đánh dấu');
    expect(canvasElement.querySelector('.starci-core-code-line')).toBeNull();
    await userEvent.click(fold);
    await waitFor(() => expect(canvasElement.querySelectorAll('.starci-core-code-line')).toHaveLength(8));
  },
};

/** `scheme="dark"` on a light page, and `scheme="light"` inside a dark one: the block's own tokens. */
export const CodeSchemes: Story = {
  render: () => (
    <G.Stack gap="section">
      <div style={{ maxInlineSize: 760 }}><G.CodeBlock code={EXCERPT} language="ts" path="products.ts" start={64} highlightLines={[[67, 69]]} scheme="dark" labels={VI} /></div>
      <div className="dark" style={{ background: 'var(--background)', padding: 16, maxInlineSize: 792 }}>
        <G.CodeBlock code={EXCERPT} language="ts" path="products.ts" start={64} highlightLines={[[67, 69]]} labels={VI} note="Theo theme của trang (dark)." />
      </div>
    </G.Stack>
  ),
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('[data-component="CodeBlock"][data-theme="dark"]')).not.toBeNull();
  },
};

const OPTIONS: readonly G.GradedChoiceOption[] = [
  { id: 'a', label: 'Lệnh xóa chưa kịp chép sang replica của Redis.', isCorrect: false, explanation: 'Replica chỉ trễ vài mili giây, còn giá cũ sống gần đủ 30 giây, đúng một TTL: phải có ai đó ghi lại giá cũ.' },
  { id: 'b', label: 'Lượt đọc chậm lấy giá cũ từ sổ trước khi đổi giá, rồi ghi vào Redis sau lệnh xóa.', isCorrect: true, explanation: 'Hai phía cùng ghi vào Redis mà không ai biết bản nào mới hơn, nên bản cũ đến sau đã đè lên.' },
  { id: 'c', label: 'CDN và trình duyệt còn giữ trang cũ.', isCorrect: false, explanation: 'Nếu là CDN thì gọi thẳng API sẽ thấy giá mới, nhưng API vẫn trả 249.000đ lấy từ Redis.' },
  { id: 'd', label: 'Sổ giá chưa lưu xong lúc lệnh xóa chạy.', isCorrect: false, explanation: 'Marketing lưu xong rồi mới xóa, nên lúc đó sổ đã có 199.000đ.' },
];

/** The same question graded by a server: the answers carry no key; the story stands in for the server with a short delay. */
const ServerGraded = () => {
  const [verdicts, setVerdicts] = useState<Readonly<Record<string, G.GradedChoiceVerdict>>>({});
  const [pendingId, setPendingId] = useState<string | undefined>(undefined);
  const grade = (id: string) => {
    setPendingId(id);
    setTimeout(() => {
      const right = OPTIONS.find((option) => option.isCorrect === true)?.id;
      setVerdicts((now) =>
        id === right
          ? Object.fromEntries(OPTIONS.map((option) => [option.id, now[option.id] ?? { state: option.id === id ? 'correct' : 'reason', explanation: option.explanation }]))
          : { ...now, [id]: { state: 'wrong', explanation: OPTIONS.find((option) => option.id === id)?.explanation } },
      );
      setPendingId(undefined);
    }, 300);
  };
  return (
    <G.GradedChoice
      grading="server"
      label="Chọn đáp án"
      options={OPTIONS.map((option) => ({ id: option.id, label: option.label }))}
      verdicts={verdicts}
      {...(pendingId === undefined ? {} : { pendingId })}
      onPick={grade}
      labels={{ wrong: 'Chưa đúng', correct: 'Đúng', whyNot: 'Vì sao không phải', grading: 'Đang chấm' }}
    />
  );
};

/** Server grading: a pick waits for its verdict; the right one releases every answer's reason. */
export const QuestionServerGraded: Story = {
  render: () => (
    <div style={{ maxInlineSize: 720 }}>
      <ServerGraded />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const options = canvasElement.querySelectorAll<HTMLButtonElement>('.starci-core-graded-option');
    await userEvent.click(options[0] as HTMLButtonElement);
    await waitFor(() => expect(options[0]?.getAttribute('data-grammar-graded-state')).toBe('wrong'));
    await userEvent.click(options[1] as HTMLButtonElement);
    await waitFor(() => expect(options[1]?.getAttribute('data-grammar-graded-state')).toBe('correct'));
    expect(options[2]?.textContent).toContain('Vì sao không phải');
  },
};

/** The question: a wrong pick locks in danger with its reason, the right pick turns success and the rest dim. */
export const Question: Story = {
  render: () => (
    <div style={{ maxInlineSize: 720 }}>
      <G.GradedChoice label="Chọn đáp án" options={OPTIONS} labels={{ wrong: 'Chưa đúng', correct: 'Đúng' }} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const options = canvasElement.querySelectorAll<HTMLButtonElement>('.starci-core-graded-option');
    await userEvent.click(options[0] as HTMLButtonElement);
    await waitFor(() => expect(options[0]?.getAttribute('data-grammar-graded-state')).toBe('wrong'));
    expect(options[0]?.textContent).toContain('Chưa đúng');
    (options[0] as HTMLButtonElement).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(options[1]);
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(options[1]?.getAttribute('data-grammar-graded-state')).toBe('correct'));
    expect(options[2]?.getAttribute('data-grammar-graded-state')).toBe('spent');
    expect(options[2]?.getAttribute('aria-disabled')).toBe('true');
  },
};

/** The question after a wrong pick and the right one (controlled `picks`): the resting state a returning learner sees. */
export const QuestionSolved: Story = {
  render: () => (
    <div style={{ maxInlineSize: 720 }}>
      <G.GradedChoice label="Đáp án" options={OPTIONS} picks={['a', 'b']} labels={{ wrong: 'Chưa đúng', correct: 'Đúng' }} />
    </div>
  ),
};

const NOTES: readonly G.SidenoteItem[] = [
  { id: 'redis', term: 'Redis', note: 'Kho dữ liệu trong bộ nhớ. Ở đây nó giữ bản chép của giá để trang đọc nhanh.' },
  { id: 'ledger', term: 'Sổ giá', note: 'Bảng giá thật trong Postgres. Đổi giá là ghi vào đây.' },
  { id: 'ttl', term: 'TTL', note: 'Thời gian một bản chép được giữ trước khi tự hết hạn.' },
];

const Prose = () => (
  <>
    <G.Text as="p" role="reading.body">Còn hai phút tới giờ sale, marketing đổi giá nồi chiên sớm để thử. Một khách mở trang nồi chiên; máy chủ web không thấy giá trong <G.SidenoteTerm id="redis">Redis</G.SidenoteTerm> nên đi đọc sổ giá: 249.000đ.</G.Text>
    <G.Text as="p" role="reading.body">Máy chủ đó khựng lại một nhịp trước khi ghi giá vào Redis. Đúng lúc đó marketing ghi 199.000đ vào <G.SidenoteTerm id="ledger">sổ giá</G.SidenoteTerm> rồi xóa giá cũ trong Redis. Máy chủ chạy tiếp và ghi 249.000đ vào Redis.</G.Text>
    <G.Text as="p" role="reading.body">Trang vẫn hiện 249.000đ thêm gần 30 giây, đúng một <G.SidenoteTerm id="ttl">TTL</G.SidenoteTerm>, dù sổ giá đã là 199.000đ.</G.Text>
  </>
);

/** A wide frame: the notes in the margin, each level with its dotted term. */
export const MarginNotes: Story = {
  render: () => (
    <div style={{ maxInlineSize: 1040 }}>
      <G.Sidenotes notes={NOTES} title="Thuật ngữ trong câu" foldLabel={(n) => `Thuật ngữ (${n})`}><Prose /></G.Sidenotes>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const term = canvasElement.querySelector<HTMLElement>('[data-component="SidenoteTerm"]');
    const note = document.getElementById(term?.getAttribute('aria-describedby') ?? '');
    expect(note?.textContent).toContain('Kho dữ liệu');
    await waitFor(() => {
      const side = canvasElement.querySelector<HTMLElement>('.starci-core-sidenotes-side');
      expect(side?.offsetParent).not.toBeNull();
    });
  },
};

/** A phone-wide frame: the margin folds into "Thuật ngữ (3)" under the prose; a press on a term opens it. */
export const MarginNotesOnPhone: Story = {
  render: () => (
    <div style={{ inlineSize: 360 }}>
      <G.Sidenotes notes={NOTES} title="Thuật ngữ trong câu" foldLabel={(n) => `Thuật ngữ (${n})`}><Prose /></G.Sidenotes>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const fold = within(canvasElement).getByRole('button', { name: /Thuật ngữ \(3\)/ });
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(canvasElement.querySelector('[data-component="SidenoteTerm"]') as HTMLElement);
    await waitFor(() => expect(fold.getAttribute('aria-expanded')).toBe('true'));
  },
};

const SECTIONS = [
  { id: 'toc-happened', label: 'Chuyện gì đã xảy ra' },
  { id: 'toc-root', label: 'Gốc rễ' },
  { id: 'toc-fix', label: 'Cách sửa' },
  { id: 'toc-cost', label: 'Cái giá' },
  { id: 'toc-code', label: 'Code' },
];

const Outline = () => {
  const [active, setActive] = useState('');
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 16rem', gap: 32, alignItems: 'start' }}>
      <G.Stack gap="region">
        {SECTIONS.map((section) => (
          <section key={section.id} id={section.id} style={{ minBlockSize: 360 }}>
            <G.Text as="p" role="title.section">{section.label}</G.Text>
            <G.Text as="p" role="reading.body">Đoạn văn của phần “{section.label}”.</G.Text>
          </section>
        ))}
      </G.Stack>
      <div style={{ alignSelf: 'stretch' }}>
        <G.TableOfContents title="Trong phần này" items={SECTIONS} onActiveChange={setActive} />
        <span data-testid="active" hidden>{active}</span>
      </div>
    </div>
  );
};

/** The sticky outline beside five sections: the one in view is marked; a press jumps to its section. */
export const Outline_: Story = {
  name: 'Outline',
  render: () => <Outline />,
  play: async ({ canvasElement }) => {
    const nav = within(canvasElement).getByRole('navigation', { name: 'Trong phần này' });
    const links = within(nav).getAllByRole('link');
    expect(links[0]?.getAttribute('aria-current')).toBe('location');
    await userEvent.click(links[3] as HTMLElement);
    await waitFor(() => expect(links[3]?.getAttribute('aria-current')).toBe('location'), { timeout: 4000 });
  },
};

const TIMED = [
    { id: 'toc-night', label: 'Đêm flash sale ở Bếp Xanh' },
    { id: 'toc-del', label: 'Giá cũ quay lại sau DEL', meta: '23:58' },
    { id: 'toc-order', label: 'Hai lần ghi đến sai thứ tự', meta: '23:59' },
    { id: 'toc-expiry', label: 'Một key hết hạn, một lần nạp', meta: '00:00' },
];

/** 0.58.0: sections with a time lead, and the quiet note under the list. */
export const OutlineTimed: Story = {
  render: () => (
    <div style={{ maxInlineSize: 240 }}>
      <G.TableOfContents title="Trong phần này" items={TIMED} note="Tự kiểm tra: 1/4 đúng" />
    </div>
  ),
};

/** 0.58.0: the phone bar names the section in view; a press opens the list, a pick jumps and closes it. */
export const OutlineBar: Story = {
  render: () => (
    <div style={{ inlineSize: 360 }}>
      <G.TableOfContents kind="bar" title="Trong phần này" items={TIMED} position={(index, total) => `Chương ${String(index)}/${String(total)}`} />
      {TIMED.map((section) => (
        <section key={section.id} id={section.id} style={{ minBlockSize: 320 }}>
          <G.Text as="p" role="title.section">{section.label}</G.Text>
        </section>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const bar = within(canvasElement).getByRole('button', { expanded: false });
    expect(bar.textContent).toContain('Chương 1/4');
    await userEvent.click(bar);
    await waitFor(() => expect(bar.getAttribute('aria-expanded')).toBe('true'));
  },
};

/** 0.58.0: on a phone, `narrow="inline"` opens a term's note in the paragraph, under the term; the body marks its own terms (`terms`). */
export const MarginNotesInline: Story = {
  render: () => (
    <div style={{ inlineSize: 360 }}>
      <G.Sidenotes notes={NOTES} title="Thuật ngữ" foldLabel={(n) => `Thuật ngữ (${n})`} narrow="inline">
        <G.Markdown source={'Máy chủ không thấy giá trong Redis nên đọc sổ giá. Trang vẫn hiện 249.000đ thêm gần một TTL; `TTL` trong code không bị đánh dấu.'} terms={NOTES.map((note) => ({ id: note.id, term: note.term }))} />
      </G.Sidenotes>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const terms = canvasElement.querySelectorAll<HTMLElement>('[data-component="SidenoteTerm"]');
    expect(terms).toHaveLength(2);
    await userEvent.click(terms[0] as HTMLElement);
    await waitFor(() => expect(terms[0]?.getAttribute('aria-expanded')).toBe('true'));
  },
};
