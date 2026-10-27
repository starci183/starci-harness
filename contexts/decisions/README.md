# Decisions

| File | Holds | Read by |
|---|---|---|
| [rulings.yaml](rulings.yaml) | the one log of owner rulings: id, date, status, the ruling, the owner of the fact now; pins; removed vocabulary | authors citing a decision; the parity gate (pins); the vocabulary check |
| [open-core.md](open-core.md) | choices made writing patterns, hfs, stack and this log, awaiting the owner; what `policy/` should take | the owner |
| [open-grammar.md](open-grammar.md) | the same for grammars and vendor | the owner |
| [open-ui.md](open-ui.md) | the same for ui | the owner |
| [legacy-retirement.md](legacy-retirement.md) | the inventory and plan that retires the legacy runtime: its context map, the context still to move, the packages' TypeScript plan and the deletion checklist; deleted once the deletion is done | the owner |

The `open-*.md` files are the owner's review queue. A confirmed row moves to `rulings.yaml` and is deleted from its
open file; an overturned one is rewritten in the knowledge file it shaped, in its one place.
