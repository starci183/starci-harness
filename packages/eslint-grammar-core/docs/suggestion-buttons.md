# Suggestion buttons

Law module: `suggestion-buttons.ts`. Finding code: `FE_SUGGESTION_BUTTONS`. Knowledge: `knowledge/ui/presentation/grammar-laws.yaml#SUGGESTION-BUTTONS`.

Suggestions, quick replies and empty-state shortcuts (the assistant drawer, chat composer suggestions) have ONE pattern: a `Cluster gap="inline"` (with a `label`) of neutral `Button size="sm"`. Every Button size draws a pill. The law refuses the alternatives drawn as suggestions: Links, ChoiceChips and Chips that run an action or send their own label.

The rule is an error in `coreGrammarConfig`; it cannot be switched off or suppressed inline.

## `starci-grammar/suggestion-buttons`

Flagged, in cheap static shapes only:

- a row (two or more siblings in a Grammar `Cluster` or `Stack`, or a `div`, through fragments, `cond && x`, ternaries and `.map`; or one Link drawn by a `.map`) of Grammar `Link`s whose `onFollow` or `onPress` is an inline arrow passing the Link's own label (`{q}` and `send(q)`, `{item.label}` and `ask(item.label)`, or an equal string literal) and whose `href` is absent or `"#"`;
- a Grammar `ChoiceChips` whose `onValueChange` is an inline arrow calling something that is not a state setter with the value, or is a bare `send`/`ask`/`submit`/`reply`/`post`/`dispatch` function: it sends the choice instead of keeping it selected;
- a HeroUI `Chip` (imported from `@heroui/react`) whose `onPress` or `onClick` passes its own label.

Grammar `Badge` has no action prop and Grammar `TagGroup` only `onRemove(ids)` and `onReorder(ids)`, so neither is judged. A spread, a computed prop, an unreadable handler, or a callee named `set*`, `on*`, `handle*` or `update*` is not flagged.

**Invalid**

```tsx
<Cluster>{questions.map((q) => <Link key={q} href="#" onFollow={() => send(q)}>{q}</Link>)}</Cluster>
<ChoiceChips label="Ask" options={options} onValueChange={(v) => send(v)} />
```

**Valid**

```tsx
<Cluster gap="inline" label="Suggested questions">
  {questions.map((q) => <Button key={q} size="sm" onPress={() => send(q)}>{q}</Button>)}
</Cluster>
```

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
