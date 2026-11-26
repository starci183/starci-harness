import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * OFFSET POP PARITY (0.60.1). The learning-app shapes of the Offset Pop playbook (a lesson list, a practice step, a streak and its
 * progress, a profile, a leaderboard) and the content renderers that draw their own edge (Board, the measure tracks, GradedChoice,
 * SchemaForm marks and ConflictCard, an emphasised SurfaceCard), each under `OffsetPopGrammarRoot` with the family palette, at 1440
 * and 390, light and dark. The copy on screen is Vietnamese; the English of each line is in the comment beside it.
 */
const meta: Meta = {
  title: 'Offset Pop/Parity',
  parameters: {
    grammar: { bleed: false },
    viewport: {
      options: {
        desk1440: { name: 'Desktop 1440 x 900', styles: { width: '1440px', height: '900px' }, type: 'desktop' },
        phone390: { name: 'Phone 390 x 844', styles: { width: '390px', height: '844px' }, type: 'mobile' },
      },
    },
  },
};
export default meta;
type Story = StoryObj;

const noop = () => undefined;

/* ------------------------------------------------------------------ learning shapes */

/** Lessons of a course: a list section, a number in front of each row, the state as a badge ("Done", "In progress"). */
const LessonList = () => (
  <G.Section
    kind="list"
    title="Bài học" // Lessons
    items={[
      { id: 'l1', title: 'Chào hỏi', description: '5 phút · 12 từ', leading: { position: 1 }, badges: [{ label: 'Xong', tone: 'success' }] }, // Greetings · Done
      { id: 'l2', title: 'Gọi món', description: '7 phút · 18 từ', leading: { position: 2 }, badges: [{ label: 'Đang học', tone: 'accent' }] }, // Ordering food · In progress
      { id: 'l3', title: 'Hỏi đường', description: '6 phút · 15 từ', leading: { position: 3 } }, // Asking the way
    ]}
    empty={<G.EmptyNotice message="Chưa có bài học" />} // No lessons yet
  />
);

const OPTIONS: readonly G.GradedChoiceOption[] = [
  { id: 'a', label: 'Xin chào', isCorrect: true, explanation: 'Câu chào dùng được với mọi người.' }, // Hello · A greeting for anyone.
  { id: 'b', label: 'Tạm biệt', explanation: 'Đây là câu chào khi ra về.' }, // Goodbye · Said when leaving.
  { id: 'c', label: 'Cảm ơn', explanation: 'Đây là lời cảm ơn.' }, // Thank you · Said to thank.
];

/** One question per screen: where the reader is in the set, the prompt, the graded answers, one primary action. */
const PracticeStep = () => {
  const [picks, setPicks] = useState<readonly string[]>([]);
  return (
    <G.Stack gap="section">
      {/* Question 4 of 10 */}
      <G.Progress label="Câu 4 trên 10" steps={{ total: 10, completed: 3 }} />
      {/* What is "Hello" in Vietnamese? */}
      <G.Heading level={2}>"Hello" trong tiếng Việt là gì?</G.Heading>
      {/* Choose an answer · Not quite · Correct */}
      <G.GradedChoice label="Chọn đáp án" options={OPTIONS} picks={picks} onPicksChange={setPicks} labels={{ wrong: 'Chưa đúng', correct: 'Đúng rồi' }} />
      {/* Continue */}
      <G.Button variant="primary" width="fill" isDisabled={!picks.includes('a')} onPress={noop}>Tiếp tục</G.Button>
    </G.Stack>
  );
};

/** The streak and the week: key figures, a measure of the weekly goal, the unit's progress. */
const StreakProgress = () => (
  <G.Stack gap="section">
    <G.Section
      kind="figures"
      title="Tuần này" // This week
      items={[
        { id: 'streak', term: 'Chuỗi ngày', value: 12, unit: 'ngày' }, // Streak · days
        { id: 'xp', term: 'Điểm kinh nghiệm', value: '1.240' }, // Experience points
        { id: 'words', term: 'Từ đã học', value: 86 }, // Words learned
      ]}
    />
    {/* Weekly goal · 3 of 5 days */}
    <G.Meter label="Mục tiêu tuần" value={60} valueLabel="3 trên 5 ngày" />
    {/* Unit 2 */}
    <G.Progress label="Chương 2" value={45} valueText="45%" />
  </G.Stack>
);

/** The reader's own card: the next step is the one emphasised card, the facts beside it. */
const Profile = () => (
  <G.Grid kind="cards">
    {/* Next step · Keep learning */}
    <G.SurfaceCard label="Bước tiếp theo" emphasis="accent" actions={<G.Button variant="primary" onPress={noop}>Học tiếp</G.Button>}>
      {/* Lesson 2 · Ordering food */}
      <G.Text>Bài 2 · Gọi món</G.Text>
    </G.SurfaceCard>
    {/* Profile */}
    <G.SurfaceCard label="Hồ sơ">
      <G.Section kind="list" layout="keyValue" ariaLabel="Hồ sơ" empty={null} items={[ // Profile
        { id: 'name', title: 'Tên', value: 'Minh An' }, // Name
        { id: 'level', title: 'Cấp độ', value: 'Sơ cấp 2' }, // Level · Beginner 2
        { id: 'since', title: 'Học từ', value: 'Tháng 9, 2026' }, // Learning since · September 2026
      ]} />
    </G.SurfaceCard>
  </G.Grid>
);

/** The week's ranking: the place in front, the points at the end; the reader's own row is marked by the accent edge and its words. */
const Leaderboard = () => (
  <G.Section
    kind="list"
    title="Bảng xếp hạng tuần" // Weekly leaderboard
    items={[
      { id: 'p1', title: 'Lan', leading: { position: 1 }, value: '2.310 XP' },
      { id: 'p2', title: 'Minh An (bạn)', leading: { position: 2 }, value: '1.240 XP', edgeTone: 'accent' }, // Minh An (you)
      { id: 'p3', title: 'Quân', leading: { position: 3 }, value: '1.105 XP' },
    ]}
    empty={<G.EmptyNotice message="Chưa ai ghi điểm tuần này" />} // Nobody has scored this week
  />
);

const LearningScreens = () => (
  <G.Stack gap="region">
    <LessonList />
    <PracticeStep />
    <StreakProgress />
    <Profile />
    <Leaderboard />
  </G.Stack>
);

/* ------------------------------------------------------------------ content renderers with their own edge */

type Stages = Readonly<Record<string, ReadonlyArray<string>>>;
const people: Readonly<Record<string, string>> = { an: 'Minh An', lan: 'Lan', quan: 'Quân' };

const SmallBoard = () => {
  const [stages, setStages] = useState<Stages>({ todo: ['an', 'lan'], doing: ['quan'], done: [] });
  const rows = (id: string) => (stages[id] ?? []).map((item) => ({ id: item, title: people[item] ?? item, description: 'Bài tập về nhà' })); // Homework
  const columns: ReadonlyArray<G.BoardColumn> = [
    { id: 'todo', title: 'Cần làm', count: rows('todo').length, items: rows('todo'), empty: <G.EmptyNotice message="Trống" /> }, // To do · Empty
    { id: 'doing', title: 'Đang làm', count: rows('doing').length, items: rows('doing'), empty: <G.EmptyNotice message="Trống" /> }, // Doing
    { id: 'done', title: 'Đã xong', count: rows('done').length, items: rows('done'), empty: <G.EmptyNotice message="Chưa có bài nào" /> }, // Done · Nothing yet
  ];
  return (
    <G.Board
      label="Bài tập" // Assignments
      columns={columns}
      onMove={({ itemId, fromColumnId, toColumnId }) => setStages((current) => ({ ...current, [fromColumnId]: (current[fromColumnId] ?? []).filter((id) => id !== itemId), [toColumnId]: [...(current[toColumnId] ?? []), itemId] }))}
      moveLabels={{
        instructions: 'Alt và mũi tên trái hoặc phải chuyển thẻ sang cột trước hoặc sau.', // Alt and the left or right arrow move the card to the previous or next column.
        announce: (item, column) => `Đã chuyển ${item} sang ${column}`, // Moved {item} to {column}
        announceAsk: (item, column) => `Cần thêm thông tin trước khi chuyển ${item} sang ${column}`, // More details are needed before moving {item} to {column}
      }}
    />
  );
};

const ContentRenderers = () => (
  <G.Stack gap="region">
    <SmallBoard />
    <G.FunnelChart
      label="Học viên theo chặng" // Learners by stage
      stages={[{ label: 'Đăng ký', count: 1200 }, { label: 'Bắt đầu', count: 840 }, { label: 'Hoàn thành', count: 310 }]} // Signed up · Started · Finished
      empty={<G.EmptyNotice message="Chưa có dữ liệu" />} // No data yet
    />
    <G.ProportionBar
      label="Thời gian học theo kỹ năng" // Study time by skill
      empty="Chưa có dữ liệu" // No data yet
      parts={[{ id: 'listen', label: 'Nghe', value: 5 }, { id: 'speak', label: 'Nói', value: 3 }, { id: 'read', label: 'Đọc', value: 2 }]} // Listening · Speaking · Reading
    />
    <G.ConflictCard
      title="Hai mục tiêu khác nhau" // Two goals disagree
      current={{ label: 'Đang dùng', text: 'Học 10 phút mỗi ngày.', source: 'đặt ngày 2/11' }} // In use · Study 10 minutes a day · set on 2 Nov
      proposed={{ label: 'Đề xuất mới', text: 'Học 15 phút vào ngày thường.', source: 'hôm nay' }} // New suggestion · Study 15 minutes on weekdays · today
      choices={[{ label: 'Giữ cái cũ', press: noop }, { label: 'Dùng cái mới', press: noop }]} // Keep the old · Use the new
    />
  </G.Stack>
);

/* ------------------------------------------------------------------ the eight views */

const family = (theme: 'light' | 'dark', width: 'desk1440' | 'phone390') => ({
  grammarFamily: 'offset-pop',
  grammarPalette: 'family',
  grammarTheme: theme,
  viewport: { value: width, isRotated: false },
});

/** Every bar track wears the ink ring, a Board card the outline and the small offset, and the emphasised card its pink offset. */
const stickersHold = async (canvasElement: HTMLElement) => {
  await waitFor(() => {
    const track = canvasElement.querySelector<HTMLElement>('.starci-core-funnel-track');
    expect(track).not.toBeNull();
    expect(getComputedStyle(track as HTMLElement).boxShadow).not.toBe('none');
  });
  const card = canvasElement.querySelector<HTMLElement>('.starci-core-board-cards > .starci-core-list-row');
  expect(card).not.toBeNull();
  expect(getComputedStyle(card as HTMLElement).borderTopWidth).toBe('2px');
  expect(getComputedStyle(card as HTMLElement).boxShadow).not.toBe('none');
};

const learningHolds = async (canvasElement: HTMLElement) => {
  await waitFor(() => expect(canvasElement.querySelectorAll('.starci-core-graded-option').length).toBe(3));
  const option = canvasElement.querySelector<HTMLElement>('.starci-core-graded-option') as HTMLElement;
  expect(getComputedStyle(option).borderTopWidth).toBe('2px');
  const emphasised = canvasElement.querySelector<HTMLElement>('[data-grammar-surface-emphasis="accent"]') as HTMLElement;
  expect(getComputedStyle(emphasised).boxShadow).not.toBe('none');
};

export const LearningLight1440: Story = { name: 'Learning screens · light · 1440', globals: family('light', 'desk1440'), render: () => <LearningScreens />, play: async ({ canvasElement }) => learningHolds(canvasElement) };
export const LearningDark1440: Story = { name: 'Learning screens · dark · 1440', globals: family('dark', 'desk1440'), render: () => <LearningScreens />, play: async ({ canvasElement }) => learningHolds(canvasElement) };
export const LearningLight390: Story = { name: 'Learning screens · light · 390', globals: family('light', 'phone390'), render: () => <LearningScreens />, play: async ({ canvasElement }) => learningHolds(canvasElement) };
export const LearningDark390: Story = { name: 'Learning screens · dark · 390', globals: family('dark', 'phone390'), render: () => <LearningScreens />, play: async ({ canvasElement }) => learningHolds(canvasElement) };

export const ContentLight1440: Story = { name: 'Content renderers · light · 1440', globals: family('light', 'desk1440'), render: () => <ContentRenderers />, play: async ({ canvasElement }) => stickersHold(canvasElement) };
export const ContentDark1440: Story = { name: 'Content renderers · dark · 1440', globals: family('dark', 'desk1440'), render: () => <ContentRenderers />, play: async ({ canvasElement }) => stickersHold(canvasElement) };
export const ContentLight390: Story = { name: 'Content renderers · light · 390', globals: family('light', 'phone390'), render: () => <ContentRenderers />, play: async ({ canvasElement }) => stickersHold(canvasElement) };
export const ContentDark390: Story = { name: 'Content renderers · dark · 390', globals: family('dark', 'phone390'), render: () => <ContentRenderers />, play: async ({ canvasElement }) => stickersHold(canvasElement) };
