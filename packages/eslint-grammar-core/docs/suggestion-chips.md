# Suggestion chips

Law module: `suggestion-chips.ts`. Finding code: `FE_SUGGESTION_CHIPS`. Knowledge: `knowledge/ui/presentation/grammar-laws.yaml#SUGGESTION-CHIPS`.

Quick replies and suggested questions (the assistant drawer, chat composer suggestions, empty-state shortcuts) are `SuggestionChips`: pill chips, 28px high, in a labelled toolbar, each chip a button. A row of small neutral Buttons that each send their own label is the same thing drawn without the toolbar label and the chip look, so the law refuses it.

The rule is an error in `coreGrammarConfig`; it cannot be switched off or suppressed inline.

## `starci-grammar/suggestion-chips`

The rendered children of a Grammar `Cluster` or `Stack`, or a `div` (through fragments, `cond && x`, ternaries and `.map`) are a finding when two or more of them are suggestion Buttons, or one is drawn by a `.map`. A suggestion Button is a Grammar `Button` that:

- states `size="sm"` literally;
- has no `intent`, or a literal `intent` of `neutral` or `alternative`;
- has an inline arrow `onPress` whose one call passes the same expression as the Button's single child (`{q}` and `send(q)`, `{item.label}` and `ask(item.label)`), or the same string literal as the literal child text.

A spread, a computed `size` or `intent`, a handler that is not an inline arrow, a label with several children, or a handler that sends something else (an id) is not judged.

**Invalid**

```tsx
<Cluster>{questions.map((q) => <Button key={q} size="sm" onPress={() => send(q)}>{q}</Button>)}</Cluster>
```

**Valid**

```tsx
<SuggestionChips label="Suggested questions" items={questions.map((q) => ({ id: q, label: q }))} onSelect={send} />
```

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
