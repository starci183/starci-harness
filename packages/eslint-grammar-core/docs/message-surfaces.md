# Message surfaces

Law module: `message-surfaces.ts`. Finding code: `FE_MESSAGE_SURFACES`. Knowledge: `knowledge/ui/presentation/grammar-laws.yaml#MESSAGE-SURFACES`. Grammar laws: `DNA-COMMON-CHAT-SURFACES` (0.37.31), `DNA-COMMON-CHAT-FRAME` (0.37.33).

Every chat (team chat, an agent's chat, an inbox thread, the assistant) draws the same three faces, and they belong to the Grammar: the thread is the page tone (`--background`; a `PaneSection scroll role="log"` paints it whatever `tone` says), a message of someone else (`MessageBubble` incoming, `MessageCard`) is the flat `--surface` with no border and no shadow, and the reader's own message is `--accent` with `--accent-foreground`. The replies a message card offers are `SurfaceCard kind="list" layout="suggestions"` (one bordered list, a pressable plain-text row per reply with a chevron); the pills by the composer stay `Button size="sm"` (`suggestion-buttons`).

A chat is one frame on any page (0.37.33): its head, its thread and its composer footer are `--background`, whether it stands in a white pane, the aside, a drawer, a dialog or a popover; the rest of the page keeps its own rule. The frame is a `Pane content="chat"` (a pane whose own stack holds a thread is drawn as one too); the app gives it no tone, and a message in it is flat (no border, no shadow).

The rule is an error in `coreGrammarConfig`; it cannot be switched off or suppressed inline.

## `starci-grammar/message-surfaces`

Flagged, in cheap static shapes only:

- a `className`, `class`, `style`, `UNSAFE_className` or `UNSAFE_style` attribute on a Grammar `MessageBubble` or `MessageCard`;
- a static class string (an attribute, a template without expressions, a `cn`/`clsx`/`cx`/`classNames`/`twMerge`/`twJoin` argument) or a style key in product source that names a Grammar message part (`starci-core-message-bubble…`, `starci-core-message-card…`);
- a `PaneSection` whose `scroll` object literal states `role: "log"` together with `tone: "surface"` (the Grammar ignores it: a thread is always the page tone);
- `surface` on a chat frame: a `Pane` with `content="chat"`, or a `Pane` whose own JSX children (fragments opened) hold a `PaneSection` with `scroll.role: "log"` (the frame is `--background`; the Grammar ignores the tone).

A spread, a computed class and a tone held in a variable are not read; a thread drawn by a component of the app's own (a `ChatThreadBand`) is not seen through, so such a pane states `content="chat"`.

**Invalid**

```tsx
<MessageBubble className="shadow-none" body={text} />
<div className="[&_.starci-core-message-bubble-body]:bg-white">{thread}</div>
<PaneSection scroll={{ label: "Thread", role: "log", tone: "surface" }}>{thread}</PaneSection>
<Pane area="room" surface content="chat" footer={composer}>{head}{thread}</Pane>
```

**Valid**

```tsx
<Pane area="room" content="chat" label="Phòng" footer={composer}>{head}{thread}</Pane>
<PaneSection scroll={{ label: "Thread", role: "log", align: "end" }}>{thread}</PaneSection>
<MessageCard title="Quy trình đang dừng" body={<SurfaceCard kind="list" layout="suggestions" ariaLabel="Gợi ý" empty={null} items={replies} />} />
```
