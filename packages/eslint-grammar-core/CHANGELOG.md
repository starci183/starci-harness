# Changelog

Versioned history starts at beta; earlier history is in git.

## 0.64.1 - 2026-11-28

- Added (owner 2026-11-28 "phông chữ label lúc nhỏ lúc to"): `starci-grammar/type-nesting` (`FE_TYPE_NESTING`, law TYPE-NESTING), at error. It refuses a `Text` with a literal `reading.body`, `reading.title` or `lead` role inside a `Section`, `SurfaceCard`, `Accordion` or `Disclosure` (the reading sizes are the page's own narration), and a headed block whose literal `headingLevel` is not deeper than the block around it. The static half of DNA-COMMON-TYPE-NESTED-NOT-LARGER and DNA-COMMON-TYPE-LEAD-PAGE-ONLY; docs `docs/type-nesting.md`.

## 0.64.0 - 2026-11-26

- Versioned with @starci/grammar 0.64 (h-grammar-flowgraph-midpoint): the family minor moved with the FlowGraph spine layout (a centred spine, midpoint ports, edge kinds, merge points and bars, the step drawer); no rule changed.

## 0.63.0 - 2026-11-26

- Versioned with @starci/grammar 0.63 (h-grammar-graph-v2): the family minor moved with the MermaidDiagram graph v2 (brand-coloured logo chips, ports, the edit mark, calls and data, hover focus); no rule changed.

## 0.62.0 - 2026-11-26

- Versioned with @starci/grammar 0.62 (h-grammar-board-touch): the family minor moved with the Board drag and drop on react-aria (touch, keyboard and screen reader); no rule changed.

## 0.61.0 - 2026-11-26

- Versioned with @starci/grammar 0.61 (h-grammar-chat-avatars): the family minor moved with the chat card, the avatar cluster and the channel badge; no rule changed.

## 0.60.0 - 2026-11-26

- Versioned with @starci/grammar 0.60 (h-ci-red-1126): the family minor moved with the Grammar's board and form surfaces; no rule changed.

## 0.59.0 - 2026-11-24

- Lint rules of the Grammar's layout, text, form and surface laws, versioned with @starci/grammar; a `Pane` may hold the one `ChatFrame` of a chat pane (`pane-children`).
