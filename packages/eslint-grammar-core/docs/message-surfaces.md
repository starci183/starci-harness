# Message surfaces

Law module: `message-surfaces.ts`. Finding code: `FE_MESSAGE_SURFACES`. Knowledge: `knowledge/ui/presentation/grammar-laws.yaml#MESSAGE-SURFACES`. Grammar law: `DNA-COMMON-CHAT-SURFACES` (0.37.31).

Every chat (team chat, an agent's chat, an inbox thread, the assistant) draws the same three faces, and they belong to the Grammar: the thread is the page tone (`--background`; a `PaneSection scroll role="log"` paints it whatever `tone` says), a message of someone else (`MessageBubble` incoming, `MessageCard`) is the flat `--surface` with no border and no shadow, and the reader's own message is `--accent` with `--accent-foreground`. The replies a message card offers are `SurfaceCard kind="list" layout="suggestions"` (one bordered list, a pressable plain-text row per reply with a chevron); the pills by the composer stay `Button size="sm"` (`suggestion-buttons`).

The rule is an error in `coreGrammarConfig`; it cannot be switched off or suppressed inline.

## `starci-grammar/message-surfaces`

Flagged, in cheap static shapes only:

- a `className`, `class`, `style`, `UNSAFE_className` or `UNSAFE_style` attribute on a Grammar `MessageBubble` or `MessageCard`;
- a static class string (an attribute, a template without expressions, a `cn`/`clsx`/`cx`/`classNames`/`twMerge`/`twJoin` argument) or a style key in product source that names a Grammar message part (`starci-core-message-bubble…`, `starci-core-message-card…`);
- a `PaneSection` whose `scroll` object literal states `role: "log"` together with `tone: "surface"` (the Grammar ignores it: a thread is always the page tone).

A spread, a computed class and a tone held in a variable are not read.

**Invalid**

```tsx
<MessageBubble className="shadow-none" body={text} />
<div className="[&_.starci-core-message-bubble-body]:bg-white">{thread}</div>
<PaneSection scroll={{ label: "Thread", role: "log", tone: "surface" }}>{thread}</PaneSection>
```

**Valid**

```tsx
<PaneSection scroll={{ label: "Thread", role: "log", align: "end" }}>{thread}</PaneSection>
<MessageCard title="Quy trình đang dừng" body={<SurfaceCard kind="list" layout="suggestions" ariaLabel="Gợi ý" empty={null} items={replies} />} />
```
