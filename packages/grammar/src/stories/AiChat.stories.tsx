import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import '../core/ext/chat/styles.css';
import { AiChatThread, type AiChatLabels, type AiChatMessage, type AiChatResultPreview } from '../core/ext/chat/index.js';
import { Alert } from '../core/composite/Alert/index.js';
import { Divider } from '../core/leaf/Divider/index.js';
import { Text } from '../core/leaf/Text/index.js';

/**
 * The AI chat extension (`@starci/grammar/core/ext/chat`): `AiChatThread` over assistant-ui's external store runtime, every part Grammar.
 * The words are the ones an app passes in `labels` (here Vietnamese, as an app would). States: empty, a conversation with a code block and a
 * tool call, streaming (live tokens, stop in place of send), the proposed result, approving, and a closed session. Shot at 1440 and 390.
 */
const meta: Meta = { title: 'Navigation & Data/AI chat', parameters: { layout: 'fullscreen' } };
export default meta;
type Story = StoryObj;

const labels: AiChatLabels = {
  placeholder: 'Nhắn cho trợ lý…',
  send: 'Gửi',
  stop: 'Dừng',
  retry: 'Thử lại',
  copy: 'Sao chép',
  thinking: 'Đang nghĩ…',
  toolRunning: 'Đang chạy',
  toolDone: 'Đã xong',
  toolError: 'Lỗi',
  empty: 'Bạn muốn bước này làm gì?',
  latest: 'Tới tin mới nhất',
};

const conversation: AiChatMessage[] = [
  { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Viết giúp tôi bước gửi tin nhắn chào khách mới qua Zalo.\nNhớ xưng "em".' }] },
  {
    id: 'a1',
    role: 'assistant',
    status: 'complete',
    parts: [
      { type: 'tool-call', toolCallId: 't1', toolName: 'contacts.search', title: 'Tra danh bạ khách mới', args: { since: '7 ngày', channel: 'zalo' }, result: { count: 12 }, status: 'done' },
      {
        type: 'text',
        text: 'Em đề xuất bước **gửi lời chào** như sau:\n\n1. Lấy tên khách từ danh bạ.\n2. Gửi mẫu tin dưới đây.\n\n```ts\nconst greeting = (name: string) => `Chào ${name}, em là trợ lý của shop ạ!`\n```\n\nAnh/chị muốn chỉnh giọng văn không?',
      },
    ],
  },
  { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'Thêm mã giảm giá 10% nhé.' }] },
  {
    id: 'a2',
    role: 'assistant',
    status: 'complete',
    parts: [
      { type: 'tool-call', toolCallId: 't2', toolName: 'vouchers.create', title: 'Tạo mã giảm giá', args: { percent: 10 }, status: 'error', result: 'Hết hạn mức tạo mã trong tháng.' },
      { type: 'text', text: 'Em chưa tạo được mã mới, nên dùng mã **CHAO10** có sẵn.' },
    ],
  },
];

const preview: AiChatResultPreview = {
  title: 'Bước: Chào khách mới',
  rows: [
    { label: 'Kênh', value: 'Zalo OA' },
    { label: 'Tin nhắn', value: 'Chào {tên}, em là trợ lý của shop ạ!\nTặng anh/chị mã CHAO10 giảm 10% cho đơn đầu tiên.' },
  ],
  approveLabel: 'Đúng ý, làm tiếp',
  reviseLabel: 'Sửa tiếp',
};

const noop = () => undefined;

/** The provider's mark before each assistant turn, and the line under the composer's box that says whose key answers. */
const assistantAvatar = { name: 'Claude' } as const;
const composerHint = 'Claude · key của cửa hàng';

/** The chat fills a phone-or-desktop tall box, as on its page. */
const Frame = ({ children }: { readonly children: ReactNode }) => (
  <div style={{ blockSize: '100vh', minBlockSize: '40rem' }}>{children}</div>
);

const header = <Text role="title.section">Trợ lý bước “Chào khách mới”</Text>;

export const Empty: Story = {
  render: () => <Frame><AiChatThread messages={[]} isRunning={false} onSend={noop} labels={labels} header={header} /></Frame>,
};

export const Conversation: Story = {
  render: () => <Frame><AiChatThread messages={conversation} isRunning={false} onSend={noop} onRetry={noop} labels={labels} header={header} /></Frame>,
};

const answer = 'Em đang soạn lại tin chào với mã **CHAO10**: lời chào ngắn, xưng em, kèm hạn dùng mã trong 7 ngày để khách dễ nhớ.';

/** Live tokens: the app grows the last text part; first the thinking mark, then the running tool, then the words, one token at a time. */
export const Streaming: Story = {
  render: () => {
    const [count, setCount] = useState(0);
    const tokens = answer.split(/(?<= )/);
    const timer = useRef<ReturnType<typeof setInterval> | null>(null);
    useEffect(() => {
      timer.current = setInterval(() => setCount((value) => (value >= tokens.length + 6 ? 0 : value + 1)), 180);
      return () => { if (timer.current !== null) clearInterval(timer.current); };
    }, [tokens.length]);
    const shown = Math.max(0, count - 4);
    const messages: AiChatMessage[] = [
      ...conversation,
      { id: 'u3', role: 'user', parts: [{ type: 'text', text: 'Ghi rõ hạn dùng mã.' }] },
      ...(count < 2 ? [] : [{
        id: 'a3',
        role: 'assistant' as const,
        status: 'running' as const,
        parts: [
          { type: 'tool-call' as const, toolCallId: 't3', toolName: 'vouchers.get', title: 'Đọc mã CHAO10', args: { code: 'CHAO10' }, status: count < 4 ? 'running' as const : 'done' as const, ...(count < 4 ? {} : { result: { validDays: 7 } }) },
          { type: 'text' as const, text: tokens.slice(0, shown).join('') },
        ],
      }]),
    ];
    return <Frame><AiChatThread messages={messages} isRunning onSend={noop} onStop={noop} labels={labels} header={header} /></Frame>;
  },
};

/** Thinking: the run started and nothing came back yet. */
export const Thinking: Story = {
  render: () => (
    <Frame>
      <AiChatThread messages={[...conversation, { id: 'u3', role: 'user', parts: [{ type: 'text', text: 'Ghi rõ hạn dùng mã.' }] }]} isRunning onSend={noop} onStop={noop} labels={labels} header={header} />
    </Frame>
  ),
};

export const Preview: Story = {
  render: () => <Frame><AiChatThread messages={conversation} isRunning={false} onSend={noop} onRetry={noop} preview={preview} onApprove={noop} onRevise={noop} labels={labels} header={header} /></Frame>,
};

export const PreviewApproving: Story = {
  render: () => <Frame><AiChatThread messages={conversation} isRunning={false} onSend={noop} preview={{ ...preview, approving: true }} onApprove={noop} onRevise={noop} labels={labels} header={header} /></Frame>,
};

export const PreviewApproved: Story = {
  render: () => <Frame><AiChatThread messages={conversation} isRunning={false} onSend={noop} preview={{ ...preview, approved: true }} onApprove={noop} onRevise={noop} labels={labels} header={header} disabled /></Frame>,
};

/** The session is closed: the composer is read-only and sends nothing. */
export const Disabled: Story = {
  render: () => <Frame><AiChatThread messages={conversation} isRunning={false} onSend={noop} labels={labels} header={header} disabled /></Frame>,
};

/** A working chat: the app appends the reader's turn and streams a canned answer, so send, stop and retry go through the runtime. */
export const Live: Story = {
  render: () => {
    const [messages, setMessages] = useState<AiChatMessage[]>([]);
    const [isRunning, setRunning] = useState(false);
    const timer = useRef<ReturnType<typeof setInterval> | null>(null);
    const stop = () => { if (timer.current !== null) clearInterval(timer.current); timer.current = null; setRunning(false); };
    useEffect(() => stop, []);
    const stream = (base: AiChatMessage[]) => {
      const id = `a${base.length}`;
      const tokens = answer.split(/(?<= )/);
      let index = 0;
      setRunning(true);
      setMessages(base);
      timer.current = setInterval(() => {
        index += 1;
        setMessages([...base, { id, role: 'assistant', status: index >= tokens.length ? 'complete' : 'running', parts: [{ type: 'text', text: tokens.slice(0, index).join('') }] }]);
        if (index >= tokens.length) stop();
      }, 120);
    };
    const send = (text: string) => stream([...messages, { id: `u${messages.length}`, role: 'user', parts: [{ type: 'text', text }] }]);
    const retry = () => stream(messages.slice(0, -1));
    return <Frame><AiChatThread messages={messages} isRunning={isRunning} onSend={send} onStop={stop} onRetry={retry} labels={labels} header={header} /></Frame>;
  },
};

/** The three slots: the assistant's `sm` mark before its turns, a divider after the last message once the reader approved, the hint in the composer box's foot row. */
export const Slots: Story = {
  render: () => (
    <Frame>
      <AiChatThread
        messages={conversation}
        isRunning={false}
        onSend={noop}
        labels={labels}
        header={header}
        assistantAvatar={assistantAvatar}
        afterMessages={<Divider label="Bạn đã chốt bản 2 · luồng chạy tiếp" />}
        composerHint={composerHint}
        disabled
      />
    </Frame>
  ),
};

/** An inline error after the last message: an Alert in the thread, the composer still open with its hint. */
export const SlotsError: Story = {
  render: () => (
    <Frame>
      <AiChatThread
        messages={conversation}
        isRunning={false}
        onSend={noop}
        onRetry={noop}
        labels={labels}
        header={header}
        assistantAvatar={assistantAvatar}
        afterMessages={<Alert tone="negative" title="Claude chưa trả lời được" description="Key hết hạn mức. Kiểm tra key trong Kết nối rồi thử lại." />}
        composerHint={composerHint}
      />
    </Frame>
  ),
};
