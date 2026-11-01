# Grammar audit, 2026-11

Status: approved by the owner, 2026-11-01; part 10 holds his decisions and overrides anything above it. The refactor runs from part 9. Measured on `@starci/grammar` 0.20.2 at branch head `b4e6d392`. Consumers:
nivo-lite at 0.20.1 is the one current app; the harness `app/` tracks the package; every other app pins 0.4 to 0.12 and meets this
cohort only when it upgrades. Rule ids and rulings cited below live in [rulings.yaml](rulings.yaml),
[hfs/rules.yaml](../hfs/rules.yaml) and [contract.yaml](../grammars/contract.yaml).

## 0. The audit in one page

- **The grammar has no working eye.** `starci dna check` refuses the shipped contract (`DNA_CONTRACT_INVALID`: it expects `mustKeep`
  as an array, the contract holds a map). Run and confirmed. No op requires it, CI does not run it, no story renders in CI, nothing
  reads `ui/proof/thresholds.yaml`, and `packages/grammar` has no ESLint or Stylelint config. So every "measured" law, the whole of
  layer 1, is prose. App check at 0 proved nothing about looks because nothing in it looks.
- **The app does not own its theme.** The grammar root re-declares about 75 HeroUI tokens on its own element, so an app's `:root`
  value loses whatever its specificity. The families then derive HeroUI's tokens from private `--starci-core-*` and `--offset-pop-*`
  names, the reverse of the stated rule. nivo had to write the private names to win.
- **135 public exports: 100 keep or rename, 21 merge, 14 remove.** The canonical set is 102, with two new: the frame `Section` and the branch `BubbleMap`.
- **One card.** `SurfaceCard` with a compiler-checked `kind` replaces `SurfaceListCard`, `SurfaceAccordionCard`, `composition="joined"`
  and the stat strip, and carries tiles (part 3).
- **Tiers bind by type and check, not by word.** One ladder for grammar and apps: leaf, branch, composite, frame, and block in apps.
  `children` belongs to the frame tier, with one named exception (part 4).

## 1. Method and limits

Read: the bootstrap, contract, composition, every component page, rulings, vendor files, CONTRIBUTING, the source of every contested
component. Three Sonnet scans gave the consumer census, the theming lines and the lint inventory; I spot-checked each against the
source and re-measured the disputed counts. Tier facts and nesting counts come from small regex scripts over source.

Limits that matter:

- **Nothing was rendered.** The owner's question is about looks, and this audit judged structure from code, not screens.
- Nesting counts are same-file only. True numbers are higher, because the wrappers sit in other files.
- Consumer counts are import and JSX counts. `.map` bodies and spread props are not resolved.
- Prop counts in Appendix B are lines of `readonly x:` in a folder, so a union repeats a name. They rank components; they are not exact.
- Migration estimates are estimates. Only the counts are measured.

## 2. The root failure

The owner's corrections all have one shape: rule text followed, screen wrong.

| Correction | What the rule allowed | Why nothing caught it |
|---|---|---|
| task-list-card | bare rows, as COLLECTION-1 says | the rule was wrong and the look is not measured |
| filter-button-group | a selectable TagGroup, then the rule moved | two components did one job |
| status-soft-pair-on-background | one soft foreground for tinted and bare | a colour rule read as a lookup, not by what is behind the mark |
| chat-primary-and-surface | whatever a bubble drew | no contract for the faces until the owner saw it |
| table only when complex | `DataTable` in a card | a lint added after the fact, same-file only |
| a card already has a label | `SectionHeader` over a card | two carriers of one title, both legal |
| surface in surface banned | nested depth, which the grammar styles | the grammar ships the thing it says it bans |
| FlowGraph looks | correct structure, ugly graph | the ruling describes looks in prose; no render proof |
| buttons hug their label | `width="fill"` anywhere | a free prop with a good default nobody enforced |
| label position by card kind | every label outside | one rule for two kinds of card |

Four causes, each with its fix in this document:

1. **Choice where there should be no choice.** Every prop with two legal values is a future correction. Fix: fewer knobs, data shapes
   the compiler checks, defaults that look right (parts 3, 4, 7).
2. **Duplicates.** Two components for a job force a judgement call on every screen. Fix: part 5.
3. **Same-file lint.** Apps compose across files, so the wrong tree is invisible to a rule. Fix: whole-program rules and runtime refusal (part 4).
4. **No render proof.** Fix: lane 1 comes first, and it is the one lane that cannot be dropped.

A machine cannot certify beauty, and this standard does not pretend to. It guarantees structure by construction and hands the rest
to a person: every new or changed component ships a contact sheet the owner accepts ([contributing](../grammars/contributing.md)).
CONTRIB-15 stays true: no reviewer's taste gates a change; the owner's eye does.

## 3. The one card

### 3.1 PaneGrid against SurfaceCard

The owner's example, argued: they are not duplicates. A `Pane surface` is a flat ground with no edge, label or radius, touching its
neighbours inside a bounded height. A `SurfaceCard` floats, has an edge and a title, and sizes to its content. The test is contact:
regions that touch are panes, objects that stand apart are cards.

The real duplicates sat one step away. `SurfaceCard placement="panel"` is a pane, so it goes (no literal use in nivo-lite). A joined
card with `Divider`s is a hand-built band system, so it goes too (four uses).

### 3.2 Options

| | A. `kind` union (main) | B. Compound bodies in JSX | C. HeroUI compound parts | D. Today's siblings | E. Siblings as thin aliases |
|---|---|---|---|---|---|
| Spelling | `<SurfaceCard kind="list" items={...}/>` | `<SurfaceCard><SurfaceCardListBody/></SurfaceCard>` | `Card.Header`, `Card.Content` | `SurfaceListCard` | an alias of A |
| Wrong body refused by | compiler, in every file | lint in one file, runtime elsewhere | nothing | partly, per sibling | compiler |
| Works across files | yes: a helper returning `ListItem[]` is typed | no: `child.type` fails through a wrapper and across the client boundary | n/a | n/a | yes |
| Skeleton parity | by construction, from the same fields | each body opts in | by hand | per sibling | as A |
| Props per component | one large union | small parts | small parts | three overlapping sets | two spellings |
| Custom row drawing | named field only | anything | anything | anything | named field |
| Duplicate-free | yes | yes | yes | no | no: rulings say removed, not aliased |
| Migration | high for rows, nil for plain cards | medium | high | none | low |

**Verdict: A.** The coordinator's reading is right and I checked it. Every JSX expression has the type `JSX.Element`, so `children`
cannot name a component. B is therefore lint plus hope, and its failure is the one that bit us: a body in another file. Its runtime
check has a hole too, since `PaneGrid`'s `child.type === Pane` is defeated by any wrapper. C is the opposite of the goal: compound parts
exist to let authors arrange things. E keeps two names for one thing, against `grammar-names-are-generic`, `pane-grid` and R321.
D produced the confusion. The grammar already leans this way: `Page header`, `Tabs items`, `Sidebar groups`, `SegmentedControl options`.

### 3.3 The shape

```ts
type CardHead = { label?: string; ariaLabel?: string; fact?: string; labelEnd?: ReactNode; headingLevel?: 2 | 3 | 4 }

type ListItem = {
    id: string
    title: string
    description?: string
    leading?: { avatar: AvatarData } | { icon: IconSource } | { position: number }
    badges?: readonly [BadgeData] | readonly [BadgeData, BadgeData]     // "at most two", now a type
    state?: PresentationState
    action?: ItemAction                                                 // one visible command
    menu?: readonly MenuEntry[]                                         // the rest
    detail?: ReactNode                                                  // the one named field for custom drawing
}

type Collection =
    | { kind: "list"; items: readonly ListItem[]; empty: ReactNode; loadingRows?: number }
    | { kind: "accordion"; items: readonly AccordionItem[] }

type Band =
    | { kind: "body"; label?: string; children: ReactNode }
    | { kind: "figures"; items: readonly Figure[] }
    | { kind: "media"; artwork: ReactNode }

type Heads = CardHead & (
    | { kind?: "body"; children: ReactNode; wholeAction?: WholeCardAction; treatment?: Treatment; accentCorner?: AccentCorner; measure?: Measure }
    | { kind: "figures"; items: readonly Figure[] }
    | Collection
    | { kind: "bands"; bands: readonly [...Band[], Band | Collection] }  // n-1 seams; at most one collection, and it is last
)

type Tile = {                                                            // no label, fact or labelEnd: the name is inside
    kind: "tile"
    name: string
    mark: { logo: ImageData } | { icon: IconSource } | { avatar: AvatarData }
    description?: string
    badge?: BadgeData
    wholeAction?: WholeCardAction
    action?: ItemAction
}

export type SurfaceCardProps = { footer?: ReactNode; isSkeleton?: boolean; isHighlight?: boolean } & (Heads | Tile)
```

Decisions inside that shape, with the reason:

- **`kind` defaults to `body`.** A required `kind` adds about 150 edits and buys nothing, because `kind="body"` is as open as no `kind`.
- **Label by kind (ruling `card-label-by-kind`).** A card that heads a section has `label`, drawn outside the material in both families. A
  tile has `name` and a required `mark`, drawn inside, and the compiler refuses `label` on it. No prop and no family moves a name.
  `Grid kind="cards"` holds tiles; R366 refuses a labelled card repeated in a grid. This narrows COLLECTION-2's "equal rows, not
  equal cards": comparing a fact across peers stays rows, recognising and opening a peer is tiles. Core's old panel-title case is gone
  because a docked region is a `Pane`.
- **`empty` is required on a list.** The compiler then asks every author for an empty state.
- **`wholeAction` exists only where a card has no inner controls.** A nested interactive is a compile error, not a review note.
- **Bands.** The rule for mixing is a type: any number of `body`, `figures` or `media`, then at most one collection, last. Two
  collections are two subjects (COLLECTION-2). `media` as the first face (ruling `band-is-first-face`) is held by lint, because a
  variadic tuple gets unreadable past this. `Divider` is refused in a card: the shell draws n-1 seams.
- **Skeleton.** One `isSkeleton` on the shell. `list` draws `loadingRows` rows from the same internal row, `figures` and `tile` keep
  their cells, and `body` passes context to the `Text` and fields inside it. The label stays real text. Parity holds by construction on every
  kind but `body`; `dna check`'s skeleton-parity measures `body`.
- **Custom drawing.** `detail` is a pre-rendered `ReactNode`, deliberately not a function: a render callback cannot cross from a server
  component to a client one (open item C-7). `DataTable` cells keep a named `render` because a table is a client branch.
- **Surface nesting.** Depth goes. The context check becomes a refusal: a card inside a card, inside `Pane surface`, or inside a
  `Dialog`, `Drawer` or `Popover` throws in development and is refused by R340 and its whole-program twin. Today: 10 same-file card-in-card
  and 2 card-in-overlay in nivo-lite, 2 in `app/`.

### 3.4 Where this fails

I recommend it, so here is what it does not do.

1. **`body` is the hole, and it is most cards.** Of nivo-lite's 217 `SurfaceCard`s, none gains a compile check on what is inside. A card
   holding a card, or a `SectionHeader` as a fake title, passes the compiler. Those stay with lint, the whole-program rule and runtime
   refusal. The union protects lists, accordions, figures and tiles: about a third of the surface, the third the owner keeps correcting.
2. **`ReactNode` fields are open.** `detail`, `labelEnd`, `footer` accept anything. I typed `leading`, `badges`, `mark` and `action` tight
   and left these named. Tighter means a schema for every row, which I think is too far.
3. **Error messages.** A wrong discriminated union gives a long TypeScript error. Authors here are agents, so this costs less than it would for people.
4. **Wrappers.** An app `Props = SurfaceCardProps & {...}` destructured and spread loses narrowing. Rule: a wrapper fixes `kind` in its own type.
5. **Bundle size.** One component imports the accordion and row drawings, so a plain card pays for them unless the kinds load lazily. Measure in lane 4.
6. **`kind="panes"` is left out, against the coordinator's list.** It has no consumer and reverses live rulings: `page-panes-frame` and
   R348 refuse a grid in a card. It also needs a height: a pane grid fills a bounded host, a card sizes to content, so tracks would
   be `auto` only, with no `scroll` and no `collapse`. If a screen asks, it joins the union as one line. Owner item.
7. **Rows outside a card.** The owner's `SurfaceCardListItem` would create a second row beside the one a growing list uses. So `Section`
   takes the same `kind="list"` shape: a painted frame and an unpainted frame around one data shape, with `ListRow` internal to both. That is the one new component.
8. **Label pixels.** `SurfaceCard` and `SurfaceListCard` place labels through separate CSS. Unifying them can move pixels on 94 list cards, which is why lane 1 comes first.

### 3.5 Migration cost

| Change | nivo-lite | Codemod |
|---|---|---|
| `SurfaceCard` plain | 217 uses, no edit | none needed |
| `SurfaceListCard` to `kind="list"` | 94 uses, 83 files; 38 direct `ListRow` children, 23 app components as children | mechanical for `items.map(x => <ListRow .../>)`; each app wrapper by hand becomes a function returning items |
| `composition="joined"` to `bands` | 4 | by hand; each needs a look |
| Stat strip to `kind="figures"` | 15; 2 identical local wrappers delete | mechanical |
| `SurfaceAccordionCard` | 1 | by hand |
| Tiles | cards repeated in a `Grid`, mostly across files: 5 same-file | by hand |
| Nested cards | 10 + 2 same-file, more across files | by hand, a design decision each |
| `app/` | 18 + 5 uses | same codemod |

My estimate: about two thirds mechanical, 30 to 40 sites by hand. The hand sites are where the screens get better, so I would not shrink them.

## 4. The tier binding

### 4.1 What the tiers are today

The word tier means three things. Apps: blocks, composites, branches, leaves, a real matrix held by R26. The grammar's folders say
`primitive` while those files stamp `data-tier="atom"`, and `renderers.ts` says paths are "internal storage, not a public tier". Nothing
checks a grammar tier: the package has no lint config.

| Folder | n | take `children` | take `className` | hold state | upward imports |
|---|---|---|---|---|---|
| primitive | 53 | 23 | 20 | 4 | 3 (Button and StatusDot to Tooltip; MediaFrame to SurfaceCard, types only) |
| branch | 27 | 12 | 8 | 7 | 4 (three cards and MermaidDiagram to composites) |
| composite | 31 | 15 | 9 | 3 | 0 |
| composition | 14 | 7 | 9 | 0 | 0 |

The coordinator's 15 of 30 is right (15 of 31 by folder). FE-FUNCTION-2 limits `children` to layouts among split units, FE-FUNCTION-4
gives lower tiers flat fields, and no rule stops any of this: R92's `no-public-classname-prop` covers house components, and neither binds
the grammar. In nivo-lite, 47 of 617 component folders break it too: 15 blocks, 23 composites, 5 branches, 4 leaves. Upward imports there are
zero, because R26 is a real check. That is the lesson: the binding that is checked holds.

**Do the grammar's names earn their keep? No.** `branch` claims interaction, yet 20 of 27 hold no state, and the card sits there.
`composite` holds scroll regions, frames and bare providers beside real composites. `primitive` holds layouts. `composition` is close, but it sits
one suffix from `composite`. The words stay only if a test a machine can run sorts each component, which part 5 does.

### 4.2 The ladder

One ladder, the same words in the grammar and in apps. A tier imports nothing above it.

| Tier | Is | Test a machine can run | May import | Props | `children` |
|---|---|---|---|---|---|
| **leaf** | one element or one vendor part | no state, no effect beyond the vendor's; imports only leaves | vendor, tokens, leaves | atoms, `on*`, `isSkeleton` | `children?: string`, or none |
| **branch** | a leaf plus its own interaction state | holds `useState` for open, selected or draft; reads no data | leaves, branches | atoms, typed data (`items`, `options`), `on*`, named slots | never |
| **composite** | a fixed arrangement of leaves and branches | no state beyond a branch's; draws a fixed anatomy from fields | branches, leaves, lower composites | as branch; at most 3 `ReactNode` slots, each named for its role | never |
| **frame** | owns a region: tracks, inset, scroll, ground, or an overlay | sets layout or a portal; adds no content of its own | everything below | role props, `children` | yes: this is the tier's job |
| **block** (apps) | owns a world | reads data through hooks; a split unit | composites and below; never a block | `{ shape?, props, on? }` | never |

The grammar's `composition` becomes **frame**, because composite and composition differ by a suffix and mean different things. In apps a
new `components/frames/` slot joins the matrix between blocks and composites. Pages, layouts and overlays stay. `SurfaceCard` is a frame:
it owns a ground and draws lower tiers from `kind`. Overlays are frames too, which gives a `Dialog` body a home without an exception.

### 4.3 `children`, decided

| Tier | For | Against | Verdict |
|---|---|---|---|
| leaf | `<Button>Save</Button>` reads well; `Text` must hold a `Code` in a sentence | `ReactNode` lets a label hold a layout | `children?: string`. Named exception: `Text` inline content, with a lint that refuses a block component in it |
| branch | a `Popover` needs a body | every use is a role: trigger, panel, body; `children` hides which | never; named slots. Overlays are frames, so this costs nothing |
| composite | saves a prop for a list-like body | it is how a fixed anatomy becomes a free one, which is what `ListRow children` did | never; named slots, budget 3 |
| frame | it is the job | none | yes, and only here |
| block, page | a gate wraps content | a block that takes children owns two worlds | never in blocks. `Gate` blocks move to `features/layouts`, which may already. Frames move to `components/frames` |

### 4.4 Named exceptions

Each has a reason. No other exists, and a new one needs a ruling.

| Exception | Reason | Held by |
|---|---|---|
| `Text` inline content | a sentence holds `Code`, `Link`, `Kbd` | lint `text-inline-only` |
| `Freestyle` `className` | the one hole, with a stated reason | R341 |
| `Tooltip` behind a leaf | `disabledReason` needs one; the leaf uses the vendor part, not grammar `Tooltip` | the tier check sees no upward edge |
| `DataTable` `render` per column | a cell draws from row data; a client branch | lint: no function prop from a server file |
| Vendor field props over budget | parity forwards them | the budget counts own props only |
| `FlowGraph` props | to be split; over budget until then | owner item |

### 4.5 Enforcement: every rule has a machine

| Rule | Type | Lint | Structural |
|---|---|---|---|
| Import direction, grammar | | | new `tiers.grammar` in `hfs/slots.yaml`, read by the machine `tiers` check over `packages/grammar`; folders renamed to the tiers |
| Import direction, apps | | R26 exists | `frames` added to the matrix |
| `children` per tier, grammar | exported `NoChildren = { children?: never }`, `LabelChild = { children?: string }`: nested JSX then fails to compile for every caller | `grammar/tier-props` requires them | |
| `children` per tier, apps | | `starci-fe/tier-children` reads the unit's props type | R92 extended |
| State per tier | | `grammar/tier-state`; apps have `branch-intrinsic-state` | |
| No `className` on grammar | removed from the types | `grammar/tier-props` | |
| Prop and slot budgets | | `grammar/prop-budget` | |
| `data-tier` equals folder | | | `FE_GRAMMAR_TIER_STAMP` |
| Card composition | the `kind` union | `surface-card-kind` for `body` | `FE_SURFACE_NESTING` |
| Label by kind | `Tile` has no `label` | R366 | DNA label laws |

### 4.6 Blind spots of one-file lint

ESLint sees one file; apps split composition across files. `packages/hfs/runtime/scripts/hfs/architecture/` already walks the whole program
(`ast-walks`, `canon-jsx-clones`, `surface`), so new whole-program rules land there, each a slot rule with an R-number.

| Rule that is blind | Closing move | Limit |
|---|---|---|
| R340 card in card | `FE_SURFACE_NESTING`: a render graph of which component draws which and where it places `children`, walked from each frame | conditional JSX counts as drawn; render props unresolved |
| R351 table in card | same graph | same |
| R354 heading over one card | same graph plus sibling order | one wrapper level |
| R348 grid in a page | same graph | same |
| R366 labelled card in a grid | same graph | `.map` of a wrapper, one level |
| `single-commit-per-render` | render law `DNA-COMMON-ONE-ACCENT-FILL` | stories and uat only |
| Anything the graph cannot see | development throw from context; DNA law on the rendered tree | only what is rendered |

Three layers back each other: the compiler refuses what it can, the graph what is static, the runtime what is rendered.

### 4.7 Knowledge that contradicts the binding

| Where | Says | Fix |
|---|---|---|
| `code/fe/function.md` FE-FUNCTION-2 | "for feature composition a named `render` callback" | only on a client branch; a block takes data |
| FE-FUNCTION-2 table | no row for frame | add it |
| FE-FUNCTION-4 "Enforced by" | nothing on `children` | cite `tier-children` |
| `grammars/README.md`, `renderers.ts` | the path is storage, not a tier | the path is the tier |
| `grammars/contract.yaml` | no tier on any role | add `tier` per role |
| `code/fe/architecture.md` FE-ARCHITECTURE-2 | four component tiers | five |
| `code/fe/folder.md` FE-FOLDER-1 | four folders | five |
| `hfs/slots.yaml` `fe.components` | no frames slot | add |
| `Terminal`, `ConnectionStatus` and other JSDoc | "ATOM" | leaf |
| `data-tier="atom"`, 65 stamps | a third name for a tier | `leaf` |

Every tier violation by component is in [Appendix B](#appendix-b-tier-violations).

## 5. Every public component

Columns: nivo-lite files/uses; uses in the harness app (0.12.14) and in `app/`; uses across apps on old pins. `merge` or `remove` with tier
`internal` means the code stays and the export goes. Tier is the proposed one.

| Component | Verdict | Tier | nivo-lite f/u | harness app | app/ | old pins | Reason |
|---|---|---|---|---|---|---|---|
| Accordion | keep | branch | 1/1 | 0 | 0 | 0 | The unpainted disclosure list; also the drawing of `kind="accordion"`. |
| Alert | keep | composite | 149/209 | 14 | 8 | 16 | A notice in the page. |
| AlertDialog | keep | frame | 13/13 | 1 | 1 | 0 | Confirms one irreversible act; `body`, `footer`. |
| Avatar | keep | leaf | 13/14 | 1 | 1 | 0 | Identity mark. Initials palette is hard-coded; see theming. |
| AvatarButton | keep | leaf | 2/2 | 0 | 0 | 0 | Avatar as a press target. |
| AvatarGroup | keep | composite | 2/2 | 0 | 0 | 0 | COLLECTION-3. |
| Backdrop | remove | - | 0/0 | 0 | 0 | 0 | Zero uses. Removed by the owner's decision; a tinted brand ground is a soft card or `Freestyle`. |
| Badge | keep | leaf | 173/227 | 13 | 6 | 183 | One settled fact on a soft pair. `children: string`. Takes the text form of StatusDot. |
| BottomNav | remove | - | 0/0 | 0 | 0 | 0 | Zero uses, and banned: R316, DNA-COMMON-NO-BOTTOM-TABS and D-13 refuse the thing the grammar still exports. |
| Breadcrumbs | merge | internal | 0/0 | 2 | 0 | 3 | Merge into Page `header.breadcrumbs`. No app draws a trail elsewhere legally. |
| Button | keep | leaf | 292/567 | 13 | 14 | 423 | Command or destination. `children: string`. Drops public `variant`; keeps `width` under R352. |
| ButtonGroup | keep | composite | 2/2 | 0 | 0 | 0 | Peers on one object; a distinct job. Takes `actions` data, not children, so a decision cannot enter it. |
| Calendar | keep | branch | 0/0 | 0 | 0 | 0 | Vendor capability. |
| ChatBubble | rename | composite | 8/11 | 0 | 0 | 0 | Rename MessageBubble. The grammar-names-are-generic ruling names chat as forbidden; a message is the role. Needs the owner: the chat-primary-and-surface ruling says ChatBubble. |
| ChatBubbleSkeletons | merge | - | 5/5 | 0 | 0 | 0 | Merge into MessageBubble `isSkeleton` with `rows`. |
| Checkbox | keep | leaf | 12/13 | 1 | 1 | 0 | Vendor field. |
| CheckboxGroup | keep | composite | 24/26 | 0 | 0 | 1 | Vendor group from `options`. |
| CloseButton | merge | - | 2/2 | 0 | 0 | 0 | Merge into IconButton `dismiss` intent. Two uses. |
| Cluster | keep | frame | 91/152 | 0 | 0 | 0 | Horizontal rhythm by role. |
| Code | keep | leaf | 0/0 | 0 | 8 | 0 | Inline literal. |
| CollectionItem | remove | - | 0/0 | 0 | 0 | 0 | Zero uses. A context provider posing as a component; lists and rows set placement themselves. |
| ComboBox | keep | branch | 0/0 | 0 | 0 | 0 | Vendor capability. |
| ConnectionStatus | merge | - | 0/0 | 0 | 0 | 0 | Zero uses. Merge into `Badge isDot` with `live`; the feed word is a product reading of a status. |
| CopyField | keep | branch | 3/5 | 0 | 0 | 0 | Copy state; one job. |
| CoreGrammarRoot | keep | frame | 0/0 | 2 | 2 | 0 | Family entry over GrammarRoot; stamps the family only. |
| DataTable | keep | branch | 8/8 | 2 | 3 | 0 | Records across columns. Refused in a card except the owner's complex case. |
| DateField | keep | leaf | 6/6 | 0 | 0 | 0 | Vendor field. |
| DatePicker | keep | branch | 1/2 | 0 | 0 | 0 | Vendor. |
| DateRangePicker | keep | branch | 0/0 | 0 | 0 | 0 | Vendor capability. |
| DescriptionList | keep | composite | 38/45 | 6 | 5 | 9 | Term and value pairs. Loses `stat-strip`, a second item type under one name. |
| Dialog | keep | frame | 16/16 | 1 | 1 | 2 | Modal host. |
| Disclosure | keep | branch | 11/11 | 0 | 0 | 0 | One summary and body; `body` slot, no children. |
| Divider | keep | leaf | 21/22 | 0 | 0 | 2 | A labelled or bare line in flow. Refused inside SurfaceCard, where bands draw their own seam. |
| DragItem | keep | branch | 2/2 | 0 | 0 | 0 | Loses `leadingColor`, an app colour string; takes a tone. |
| Drawer | keep | frame | 18/18 | 0 | 0 | 1 | Edge host. |
| DropdownMenu | keep | branch | 14/15 | 0 | 0 | 1 | Commands behind a trigger. |
| EmptyNotice | keep | composite | 96/115 | 8 | 7 | 156 | Empty or failed region. Loses `actionVariant` (G-5). |
| FencedCodeBlock | keep | composite | 2/2 | 2 | 1 | 4 | Code block with copy. |
| Field | remove | internal | 0/0 | 0 | 0 | 0 | Zero uses. Internal anatomy of every field. |
| Fieldset | keep | frame | 8/10 | 0 | 0 | 0 | Hosts a group of fields. |
| FileDropzone | keep | branch | 11/11 | 0 | 0 | 1 | Drop state; generic. |
| FillViewport | merge | internal | 1/1 | 0 | 0 | 0 | Merge into `Page chrome="bleed"`, which already pairs with it, and shares PanesFill's measuring. |
| FilterButtonGroup | keep | composite | 0/0 | 0 | 0 | 0 | Filters a collection in place. Shares an internal toggle core with SegmentedControl; zero uses yet because nivo-lite pins 0.20.1. Folds Vietnamese in `foldForSearch`: move to a locale-neutral fold. |
| FlowGraph | keep | branch | 2/2 | 2 | 0 | 0 | Keep for layered, lanes, radial and manual graphs. `layout="orbit"` splits into `BubbleMap` by the owner's decision. |
| Footer | keep | composite | 1/1 | 0 | 0 | 0 | Site footer from `groups`. `children` goes. |
| Form | keep | frame | 38/40 | 1 | 1 | 23 | Hosts fields and a submit. |
| FormGrid | merge | internal | 5/6 | 0 | 0 | 0 | Merge into `Grid kind="form"`, which already renders it (UI-24). |
| Freestyle | keep | frame | 1/1 | 0 | 0 | 0 | The one sanctioned hole, with a reason. Only component that keeps `className`. |
| GrammarRoot | keep | frame | 4/4 | 0 | 0 | 1 | The one root. Loses `theme` (the mode is the app's class on `html`) and every token declaration on its element. |
| Grid | keep | frame | 25/29 | 0 | 0 | 0 | Card, form and main-rail grids; the one owner of those three layouts. |
| Heading | keep | leaf | 56/76 | 3 | 2 | 207 | Prose and landing rank only. `children: string`. Card and section titles come from their frames. |
| HorizontalScrollRegion | keep | frame | 8/8 | 0 | 0 | 1 | The named horizontal scroll owner (LAYOUT-3). |
| Icon | keep | leaf | 7/7 | 2 | 2 | 31 | One glyph at a scale step. |
| IconButton | keep | leaf | 17/24 | 0 | 0 | 11 | Button drawn square with a required name. |
| IconTile | keep | leaf | 11/14 | 0 | 0 | 16 | Neutral identity tile. |
| IdentityLockup | keep | composite | 1/1 | 2 | 2 | 0 | Workspace identity in a bar. |
| Image | keep | leaf | 16/17 | 0 | 0 | 0 | Vendor-free image with a slot. |
| IncludedMark | remove | - | 2/2 | 0 | 0 | 1 | Feature: a pricing-table tick. `Icon` does it; generic replacement is Icon. |
| Input | keep | branch | 113/224 | 3 | 3 | 97 | Field; holds reveal state, so it is a branch, not a primitive. |
| ItemActions | remove | - | 1/1 | 0 | 0 | 0 | One use. Same provider; ListRow `actions` already sets item placement. |
| Kbd | keep | leaf | 0/0 | 0 | 0 | 0 | Keyboard hint. |
| Label | remove | internal | 1/1 | 0 | 0 | 2 | One app use (`as`, `depth`). Card label internals; `depth` dies with nested cards. |
| LeadingNumber | merge | internal | 6/6 | 0 | 0 | 2 | Merge into a row's `position` field. A `1.` span. |
| Link | keep | leaf | 5/6 | 1 | 1 | 0 | The destination in text. `children: string`. |
| List | merge | internal | 47/52 | 0 | 0 | 0 | Merge into Section kind="list". The bare `ul` host invites hand rows; the list stays one data shape. |
| ListBox | keep | branch | 7/7 | 1 | 1 | 0 | Picking from a list. |
| ListItem | merge | internal | 27/27 | 0 | 0 | 0 | Merge into Section or card kind="list". 25 of 49 sampled bodies are multi-line custom rows; those are ListRow `detail` or a body band, never a hand `li`. |
| ListRow | merge | internal | 92/103 | 4 | 5 | 0 | Becomes the internal drawing of `kind="list"`. Its fields become the typed item. Loses `verdict`. |
| MarkdownArticle | keep | composite | 0/0 | 1 | 1 | 3 | Article renderer. |
| MarkdownTableFrame | remove | internal | 0/0 | 0 | 0 | 1 | Internal of MarkdownArticle; one old use. |
| Mascot | keep | leaf | 6/6 | 0 | 0 | 0 | Generated art capability with provenance. Not a feature: any product may hold character art. |
| MediaFrame | keep | leaf | 10/11 | 0 | 0 | 5 | A framed image or video with an asset slot. Drops the type import from SurfaceCard. |
| MermaidDiagram | keep | branch | 0/0 | 0 | 0 | 0 | Article diagrams. |
| Meter | keep | leaf | 15/16 | 2 | 1 | 0 | A measurement. Separate from Progress. |
| NavigationFeatureNav | merge | - | 1/1 | 0 | 0 | 4 | Merge into TopBar as a `subnavigation` slot. A second app bar, and the word Feature is in its name. |
| NavLandmark | keep | frame | 3/3 | 0 | 0 | 0 | A named `nav` for a row of links; moves tier because it hosts children. |
| NumberField | keep | leaf | 23/36 | 6 | 1 | 0 | Vendor field. |
| OffsetPopGrammarRoot | keep | frame | 0/0 | 0 | 0 | 0 | Family entry over GrammarRoot; stamps the family only. |
| OtpInput | keep | branch | 0/0 | 0 | 0 | 3 | Vendor capability. Moves under one field vocabulary (G-19). |
| Page | keep | frame | 63/67 | 0 | 0 | 0 | One route frame. Absorbs PageHeader, PageContainer, Breadcrumbs, FillViewport as internals. |
| PageContainer | merge | internal | 9/9 | 3 | 10 | 76 | Merge into Page. Rule page-frame already says an app never draws it; nivo-lite's 9 uses are landing bands, which are `Page` sections. |
| PageHeader | merge | internal | 0/0 | 0 | 5 | 0 | Merge into Page. `header` is already its data; R323-R325 make a loose one illegal. |
| Pagination | keep | composite | 0/0 | 0 | 0 | 0 | Vendor capability. |
| Pane | keep | frame | 13/41 | 0 | 0 | 0 | Cell of PaneGrid. `surface` stays: 28 uses, the owner's flat ground. A surfaced pane holds no card. |
| PaneGrid | keep | frame | 13/14 | 0 | 0 | 0 | Page-level division of a bounded height. Not a duplicate of SurfaceCard: see part 3. Loses nothing, gains `no surface in card`. |
| PaneSection | keep | frame | 31/97 | 0 | 0 | 0 | The one band of a pane. |
| PinnedActionBar | keep | frame | 0/0 | 0 | 1 | 0 | Thumb-reach decision bar. Zero current app uses but one worktree use and a contract row; docs still say `variant="primary"`. |
| PlainPressable | remove | internal | 0/0 | 0 | 0 | 0 | Zero uses. Internal of the two above. |
| Popover | keep | frame | 1/1 | 0 | 0 | 0 | Anchored host. |
| PressableField | keep | leaf | 1/1 | 0 | 0 | 1 | Field-shaped trigger (search opener). Keep: nothing else has its anatomy. |
| PrimaryRailLayout | merge | internal | 4/4 | 2 | 2 | 18 | Merge into `Grid kind="main-rail"`, which already renders it (UI-24). Two spellings of one layout. |
| Progress | keep | leaf | 5/5 | 1 | 1 | 26 | Task progress, a vendor part. Separate job from Meter (ACCENT-4). |
| ProgressCircle | keep | leaf | 1/1 | 0 | 0 | 0 | Vendor part. |
| Quote | keep | composite | 2/2 | 0 | 0 | 0 | Words from a source; not a surface. Legal in a card band. |
| RadioGroup | keep | composite | 18/22 | 2 | 2 | 5 | Vendor group from `options`. |
| Rail | merge | - | 0/0 | 0 | 0 | 3 | Merge into `Grid kind="main-rail"` `rail` slot. Zero current uses. |
| RankArtwork | remove | - | 0/0 | 0 | 0 | 1 | Feature: leaderboard medals with 11 hard-coded fills. Move to the one app that draws it, as assets. |
| Rating | keep | branch | 0/0 | 0 | 0 | 0 | Vendor gap with a proposed ruling; holds state. |
| Region | merge | internal | 42/45 | 1 | 2 | 0 | Merge into Section: a named region and its heading are one thing. |
| RelativeTime | keep | leaf | 2/2 | 2 | 2 | 0 | Shared clock (ruling grammar-menu-drawer-live-time). |
| SearchField | keep | leaf | 13/13 | 0 | 0 | 0 | Vendor field. |
| SectionHeader | merge | internal | 81/91 | 12 | 2 | 53 | Merge into Section. Free-standing it is the hand heading of R354 and of the card label rule; its `composition`, `eyebrow` go. |
| SegmentedControl | keep | composite | 25/28 | 0 | 0 | 0 | One value in a form or toolbar. Sizes fixed to sm and md: the code ships `md, lg, control`, the contract `sm, md`. 25 of 28 nivo-lite uses sit outside a Form in their file: many are filters and migrate by hand. |
| Select | keep | branch | 67/90 | 3 | 3 | 8 | Vendor. |
| Sidebar | keep | composite | 1/1 | 1 | 1 | 2 | App navigation as data. |
| Skeleton | keep | leaf | 8/9 | 0 | 0 | 4 | Inert geometry; apps should rarely need it directly. |
| Slider | keep | leaf | 1/1 | 0 | 0 | 0 | Vendor field. |
| Spinner | keep | leaf | 1/1 | 1 | 1 | 1 | Vendor part. |
| Stack | keep | frame | 133/221 | 0 | 0 | 0 | Vertical rhythm by role. |
| StateMark | remove | internal | 0/0 | 0 | 0 | 0 | Zero uses. Internal of the row's state mark. |
| StaticStateRow | merge | internal | 1/1 | 0 | 0 | 6 | Merge into the list item `state` field. Same geometry as ListRow, same CSS class, different prop shape (`item`). The purest disguised duplicate. |
| StatusDot | keep | leaf | 1/2 | 0 | 3 | 0 | Dot alone, with a tooltip name. Loses its text form, which duplicates `Badge isDot` exactly (contract Chip says so itself). |
| Stepper | keep | composite | 8/8 | 0 | 0 | 0 | Steps of a wizard. |
| Subnav | remove | - | 0/0 | 0 | 0 | 2 | Zero current uses. `Course/workspace identity` in its doc; TopBar `menu` does it. |
| SurfaceAccordionCard | merge | - | 1/1 | 0 | 0 | 9 | Merge into `SurfaceCard kind="accordion"`. Drops its render props, its `frame` mode and its second union. |
| SurfaceCard | keep | frame | 169/217 | 23 | 18 | 359 | The one card. Takes `kind` and typed data. See part 3. |
| SurfaceCopyGroup | merge | - | 2/3 | 0 | 0 | 1 | Merge into `Stack gap="identity"`. A div with a density knob. |
| SurfaceListCard | merge | - | 83/94 | 4 | 5 | 68 | Merge into `SurfaceCard kind="list"`. Loses `depth`, `isVerdict`, `labelHidden`. |
| Switch | keep | leaf | 27/29 | 0 | 0 | 0 | Vendor field. |
| Tabs | keep | branch | 11/11 | 1 | 1 | 10 | Switches panels; `items` with a `panel` slot. Page tabs stay in Page. |
| TagGroup | keep | composite | 9/9 | 2 | 2 | 0 | Values the user entered. Selection already gone from its props; nivo-lite still passes it on 0.20.1. |
| Terminal | keep | branch | 0/0 | 0 | 1 | 0 | Log tail with follow state. Generic despite the name; reads `--terminal-*` only as derived from theme. |
| Text | keep | leaf | 334/947 | 39 | 33 | 1289 | One line of copy. Named exception: inline content. Loses `weight` values to one `isStrong`, `parentEmphasis`, `metric-lead` and `accent` tone. 195 weighted uses in nivo-lite are the disguised heading. |
| TextAction | keep | leaf | 57/69 | 0 | 0 | 130 | Command in text. Loses `href`: 61 of 69 nivo-lite uses are destinations, which is what Link is for. CTA-2 says the two differ. |
| Textarea | keep | branch | 59/71 | 3 | 4 | 1 | Field; holds state. |
| TimeField | keep | leaf | 3/4 | 0 | 0 | 0 | Vendor field. |
| Timeline | keep | composite | 8/8 | 3 | 3 | 2 | Events in order. |
| Toast | remove | internal | 0/0 | 0 | 0 | 0 | Zero uses. Internal of Toaster; apps call toastQueue. |
| Toaster | keep | composite | 0/0 | 1 | 1 | 0 | The one region. |
| ToolbarActions | remove | - | 0/0 | 0 | 0 | 0 | Zero uses. Same provider; frames set chrome placement. |
| Tooltip | keep | branch | 4/7 | 1 | 0 | 0 | `content: string`; loses `children` in favour of `trigger`. |
| TopBar | keep | composite | 1/1 | 0 | 0 | 0 | The app bar. Takes `subnavigation`. |
| VerticalScrollRegion | keep | frame | 0/0 | 1 | 0 | 7 | The named vertical scroll owner. |
| Video | keep | leaf | 3/3 | 0 | 0 | 0 | Media. |
| WorkspaceShell | keep | frame | 8/8 | 1 | 1 | 10 | The app frame. |

Counts: **100 keep or rename, 21 merge, 14 remove** of 135. Two names stand out: `BottomNav` is exported while three rules ban it, and
`NavigationFeatureNav` has the word Feature in it.

The ten that matter most:

1. **`SurfaceListCard`, `SurfaceAccordionCard`: merge** into `SurfaceCard kind`. 95 uses for one job.
2. **`StaticStateRow`: merge.** Same class as `ListRow`, a different prop shape, no other difference.
3. **`DescriptionList layout="stat-strip"`: split out.** A different item type wearing the name; 2 identical app wrappers prove the card belonged inside it.
4. **`SectionHeader`, `Region`, `List`, `ListItem`: merge into `Section`.** Removes the free-standing heading, which is the hand-title bug.
5. **`StatusDot` with text: remove the form.** The contract itself says it equals `Badge isDot`.
6. **`TextAction href`: remove.** 61 of 69 uses are links wearing a command's name.
7. **`BottomNav`, `RankArtwork`, `IncludedMark`, `Subnav`: remove.** Banned or feature-shaped.
8. **`CollectionItem`, `ItemActions`, `ToolbarActions`: remove.** Context providers as components; one use between them.
9. **`NavigationFeatureNav`: merge into `TopBar`.**
10. **`ChatBubble`: rename `MessageBubble`.** The owner's own name rule forbids chat. Needs the owner.

Kept against the temptation: `PaneGrid` (3.1). `SegmentedControl` and `FilterButtonGroup` share a vendor part but do different jobs: one sets
a form value, the other narrows a list with overflow; a shared internal core is enough. `Progress` and `Meter` are vendor-distinct and ACCENT-4
needs both. `ButtonGroup` stays small.

## 6. Rules

### 6.1 Contradictions

| # | Rules in conflict | Effect | Resolution |
|---|---|---|---|
| 1 | `same-app-from-same-inputs`, `heroui-defaults-first`, contract "A role left unbound", DNA-COMMON-TOKENS-BOUND, README "App author decides: nothing" for colour, against the owner's "the app sets its own theme" | the code obeys the first set, the owner the second | structure comes out the same, paint is the app's; rewrite all five |
| 2 | README layer 1 "no surface inside a surface" against contract `depth: nested`, `surfacecard-always-painted`, BOUNDARY-5 | the grammar paints what it bans | ban it; delete depth and the nested edge; amend the ruling |
| 3 | `pane-grid.choose.frame` "cards never inside a PaneGrid" against `task-list-card` "on a page or in a pane" | an author cannot obey both | a card may sit on a canvas pane, never on `Pane surface` |
| 4 | COLLECTION-1 "never a card" with three exceptions, against `task-list-card`, `step-card-list`, rail | three judgement carve-outs; the default is what the owner keeps correcting | invert: a list is a card; `Section` when it searches, filters or pages, decidable from its props |
| 5 | CTA-1/case-6, contract Chip "peers are picked" as a TagGroup, UI-25, chip.md "selectable tag", contract `selected (TagGroup)`, against `filter-button-group` | stale text teaches the removed thing | delete those lines |
| 6 | Layer 1 "the DNA gate measures the render" and CONTRIB-8, against a gate that cannot load | every DNA citation is a false claim | lane 1 |
| 7 | `status-contrast` header "the solid tone is never the text colour" against `status-soft-pair-on-background` | the lint refuses the owner's rule | delete the lint: the owner ruled no gate on an app's colours |
| 8 | presentation "the app changes the surface, never the token", the ruling "changed in the grammar's token", the owner's final word | three answers | no gate and no rule on the contrast of an app's chosen colours; a family's defaults are the family's |
| 9 | Contract `SegmentedControl` sm, md against code md, lg, control; D-3 "control never by an app" against a public `control` | | code follows the contract |
| 10 | R17 "no rule warned" against R350 at warn | | error when the cohort closes, as the ruling says |
| 11 | `grammars/README` "Common assigns no colour" against 58 literals in `common/styles.css` | | true after lane 2 |
| 12 | `joined-multi-pane` "one joined surface" against `page-panes-frame` | | delete the first |
| 13 | LAYOUT-2 names a chat composition; FE-APP-SHELL-7 specifies a conversation pane; `hover-actions-floating-toolbar` speaks of messages | feature rules in a generic layer | rewrite in roles or move to the product |
| 14 | `Tabs` "the pill is the shape of filters", then the filter is not a pill | | delete the sentence |
| 15 | `grammar-names-are-generic` against `ChatBubble` | | rename |
| 16 | R350 and presentation say `spacing-scale` covers grammar stylesheets; the grammar has no Stylelint | a false claim, and how `1rem` survived in `PinnedActionBar` | lane 3 |
| 17 | `contract.yaml` FlowGraph `layout` lacks `lanes`, which the ruling and code have | | one owner |
| 18 | "every label outside" (old `card-label-placement-per-grammar`, DNA label laws) against tiles | fixed on this branch: ruling `card-label-by-kind`, contract, core.md, card.md; code follows in lane 4 (G-20) | done in text |

### 6.2 Rules to delete

`status-contrast`; the `contrast.*` keys as gates over app values; BOUNDARY-5 as a nested edge; `no-off-scale-glyph-size` (subsumed);
`no-heading-tag-outside-heading-component` and `no-hand-rolled-heading` (one rule); `no-fractional-step` once `no-spacing-utility` is an error;
ruling `joined-multi-pane`; CTA-1/case-6; `depth` everywhere; `no-decorative-icon-in-metric-cell` (names a component that does not exist);
FE-APP-SHELL-7 from the universal layer; G-1 to G-5 once the types close them; every threshold nothing reads and no prose needs (`steps.*`,
`latency.*`, `navigationDepth.*`, `verdict.scale`, `calibration.lenses`), or else wire them; `rule-catalog.ts` paths to files that do not exist.

### 6.3 Missing lints

In part 7. The gaps with the largest effect: no card-composition rule, no surface nesting across files, no tier binding, no literal-paint rule
on the grammar's own source, no rule against private tokens in app CSS, four published rules missing from `rules.yaml` (`exhaustive-shape-switch`,
`no-data-status-prop`, `region-reads-through-slot`, `branch-intrinsic-state`), and `shape-has-story`, which `function.md` cites and which does not exist.

## 7. The standard

### 7.1 Laws

1. **One job, one component.** If two could carry a job, one goes.
2. **A fact in, a look out.** A prop states a fact. No prop chooses a look. A default needs no prop.
3. **Data before slots, slots before children.** Prefer a typed field; then a named slot; `children` only on a frame.
4. **Wrong composition does not compile, then does not lint, then does not render.** In that order.
5. **The app owns its paint, the grammar owns its structure.** Neither reaches into the other.
6. **A claim names its enforcer** (CONTRIB-8), and every enforcer runs.

### 7.2 The canonical set

102 public components.

- **Frames (24):** GrammarRoot, CoreGrammarRoot, OffsetPopGrammarRoot, Page, WorkspaceShell, PaneGrid, Pane, PaneSection, Section (new), Stack, Cluster, Grid, SurfaceCard, Form, Fieldset, Dialog, AlertDialog, Drawer, Popover, HorizontalScrollRegion, VerticalScrollRegion, NavLandmark, PinnedActionBar, Freestyle.
- **Composites (22):** Sidebar, TopBar, Footer, Alert, Toaster, EmptyNotice, Quote, MessageBubble, FencedCodeBlock, MarkdownArticle, DescriptionList, Timeline, Stepper, Pagination, IdentityLockup, AvatarGroup, TagGroup, SegmentedControl, FilterButtonGroup, ButtonGroup, CheckboxGroup, RadioGroup.
- **Branches (23):** Input, Textarea, OtpInput, Select, ComboBox, DatePicker, DateRangePicker, Calendar, FileDropzone, CopyField, Rating, Tabs, Accordion, Disclosure, DropdownMenu, ListBox, DataTable, Tooltip, DragItem, Terminal, FlowGraph, BubbleMap (new), MermaidDiagram.
- **Leaves (33):** Text, Heading, Code, Kbd, RelativeTime, Link, TextAction, Button, IconButton, AvatarButton, Badge, StatusDot, Icon, IconTile, Avatar, Image, Video, MediaFrame, Mascot, Divider, Progress, Meter, ProgressCircle, Spinner, Skeleton, PressableField, SearchField, NumberField, Checkbox, Switch, Slider, DateField, TimeField.

Knobs that go: `SurfaceCard` `composition`, `placement`, `scroll`, `isScrollable`, `height` except `fill`; `SurfaceListCard` `depth`, `isVerdict`, `labelHidden`; `SectionHeader` `eyebrow`, `composition`; `Text` `weight`, `parentEmphasis`; every public `className` but Freestyle's; `Button variant`, `Tabs variant`, field `variant`; `EmptyNotice actionVariant`; `Alert appearance`, resolved by context (G-17); `control` as an app value.

### 7.3 The lint set

Kept as they are unless a row says otherwise. Enforcer is ESLint unless marked. R-numbers are proposals, after the last used R354.

**New**

| Id | R | Refuses |
|---|---|---|
| `starci-grammar/surface-card-kind` | R355 | hand rows, a stat list, `Divider`, `SectionHeader` or `Heading` as a direct child of a `body` card; a `Section` around one card |
| `FE_SURFACE_NESTING` (hfs) | R356 | across files: a card in a card, in `Pane surface` or in an overlay; a `DataTable` in a card; a grid outside `Page chrome="panes"`; a heading over one card |
| `starci-grammar/text-inline-only` | R357 | a block component inside `Text` |
| `starci-grammar/no-text-heading` | R358 | a strong `Text` alone heading a group of blocks |
| `starci-grammar/one-highlight-per-render` | R359 | a second `isHighlight` in a render (G-9) |
| `starci-fe/tier-children` | R360 | `children` in the props of a leaf, branch, composite or block |
| `starci-fe/no-render-prop-across-server` | R361 | a function prop passed to a client component from a server file |
| `grammar/tier-props` (package) | R362 | `children` or `className` against the tier; a missing `NoChildren` |
| `grammar/tier-state` (package) | R362 | `useState` or an effect in a leaf |
| `grammar/prop-budget` (package) | R362 | own props or `ReactNode` slots over budget: leaf 8, branch 12, composite 12 with 3 slots, frame 10 |
| `grammar/no-literal-paint` (package) | R363 | colour, radius, font or shadow literals in TS or TSX |
| `starci/grammar-token-only` (Stylelint, package) | R363 | outside `theme.css`: any colour, radius, font-family, shadow or duration literal; a private token read before a HeroUI one; an `!important` not in the wrappers manifest |
| `starci/no-grammar-private-token` (Stylelint) | R364 | an app reading or writing `--starci-core-*`, `--offset-pop-*` or `--grammar-*` |
| `FE_GRAMMAR_TIER_STAMP` (hfs) | R365 | a `data-tier` unlike the folder |
| `starci-grammar/no-label-in-grid` | R366 | a labelled card repeated in a `Grid`: it is a tile; its whole-program half is R356 |
| `tiers.grammar` (hfs machine) | R26 | an upward import in the grammar |

**Changed**

| Id | Change |
|---|---|
| `starci/brand-layer-shape` | renamed `theme-layer-shape`. Admits HeroUI's whole token list from its own `variables.css` plus `--info*` and `--font-*`, so `--scrollbar` passes. Drops family prefixes. Drops "every token in both modes": HeroUI's own common block is one value |
| `no-spacing-utility` (R350) | error at cohort close; absorbs `no-fractional-step` |
| `no-raised-surface-in-surface` (R340) | renamed `no-surface-in-surface`; refuses any card in a surface |
| `no-raw-structural-element`, with the two heading rules | one rule for headings; the scope conflict at `fe.components` resolved |
| `no-icon-size-class` | absorbs `no-off-scale-glyph-size` |
| `no-selectable-tag-group`, `no-table-in-card`, `no-heading-above-card` | stay as the fast one-file half of the whole-program rules |
| `button-intent.ts` | stops naming `ConfirmDialog` and `TableRow` |
| `control-height.ts`, `grammar-boundary.ts`, `client-boundary.ts`, `file-layout.ts` | stop using removed vocabulary |

**Deleted:** `starci/status-contrast`, `starci-grammar/no-decorative-icon-in-metric-cell`, `no-off-scale-glyph-size`, `no-fractional-step`, `no-hand-rolled-heading`, `no-heading-tag-outside-heading-component`.

**Kept unchanged, `starci-grammar`:** `app-shell-frame` (a frame not on the shell), `no-shell-bottom-tabs` (a bottom tab bar), `navbar-control-size` (a bar control off size), `navbar-cluster` (wrong action order), `no-navbar-create` (a create in the bar), `chip-label-starts-uppercase`, `slot-status-through-slotview` (a data-status branch in a pure half), `freestyle-has-reason`, `no-vendor-icon-outside-icon-leaf`, `heroicons-is-the-glyph-vendor`, `no-inline-svg-outside-brand-mark-leaf`, `generated-art-in-mascot-or-media-frame`, `mascot-asset-slot-required`, `destructive-menu-entry-needs-danger-tone`, `page-tabs-in-header`, `route-page-is-one-page`, `no-hand-rolled-page-header`, `pane-grid-children`, `pane-children`, `no-pane-section-padding`, `pane-grid-page`, `status-text-uses-soft-foreground` (the pair rule, on names, never on a contrast value), `no-unresolved-token-class`, `vendor-primitive-has-named-owner`.

**Kept unchanged, `starci-fe` UI:** `no-arbitrary-value`, `no-raw-brand-value`, `no-inline-class-name`, `class-names-in-colocated-file`, `cn-arguments-are-single-tokens`, `no-public-classname-prop`, `no-per-part-classname-prop`, `no-public-frame-css-props`, `no-css-door-type-laundering`, `public-component-signature`, the five button-intent rules, `control-height`, `no-grammar-shim`, `nested-control-variant`, `no-app-surface-paint`, `no-list-panel-padding`, `divider-full-bleed`, `no-hand-built-panes`, `no-fill-command-in-header`, `selection-fill-no-check`, `no-grammar-internal-selector`, `no-native-form-control`, `no-native-img`, `image-has-size`, the loading, drawing, shape-slot and the-split rules, `no-app-relative-clock`. What each refuses is its law in [hfs/rules.yaml](../hfs/rules.yaml).

**Kept unchanged, Stylelint:** `token-only`, `raw-brand-value`, `no-apply-raw`, `no-important`, `globals-shape`, `no-token-redefinition`, `no-css-module`, `no-class-selector`, `breakpoint-scale`, `source-resolves`, `globals-import-order`, `spacing-scale`, `no-inline-lint-config`.

Every kept rule also gets what the inventory found missing: an entry in `rules.yaml`, a `why`, a doc page, a correct `docs.url`. The four pane rules all point at R345 today.

### 7.4 The knowledge set

One owner per fact. `contract.yaml` holds what a role is, its tier and its laws, in the shape the gate reads. `ui/components/*` holds only Choose tables, and a row whose answer a type now decides is deleted. `ui/proof.md` says which ids a machine holds and which are the owner's eye. `thresholds.yaml` keeps keys something reads.

### 7.5 Looks by construction

- **Render proof runs.** Every story, both families, light and dark, 375, 768 and 1280, on every grammar change. Laws gate. Pixels do not: a diff against the last accepted sheet goes to the owner.
- **App screens.** A `uat` run keeps one screenshot per state and `audit` compares them. Both exist and neither is required: make `audit` a step of a release that changes a screen.
- **A law moves down when it recurs.** Each owner correction ends in a type, a law or the rule that was wrong, never a sentence beside it (CONTRIB-6, CONTRIB-7).

## 8. Theming

### 8.1 The standard

An app sets HeroUI's tokens in its own CSS, on `:root`, `.light` and `.dark`, and everything follows. It writes no grammar name. It may set nothing and take a family's default.

1. **Split each family sheet in two.** `@starci/grammar/<family>/theme.css` holds default token values on `:root, .light` and `.dark` in an early layer, and is optional. `styles.css` holds component rules and declares no HeroUI token. An app with its own theme skips the first or overrides it.
2. **Nothing declares a token on the grammar root.** That one change returns `:root` to the app. Derived tokens then resolve where HeroUI resolves them, so `*-soft` pairs follow the app's values and an app's own `--x-soft` wins. The derivation at `common/styles.css:76-168` goes.
3. **Components read HeroUI tokens first,** with no literal fallback and no private token in front. System colours stay inside `forced-colors` only.
4. **The private names go.** `--starci-core-accent` and its 34 kin are removed. A family's signature (Offset Pop's ink and offset) derives from HeroUI tokens, with its defaults in `theme.css`.
5. **The mode is the app's.** `.dark` on `html`. `GrammarRoot` loses `theme`: a mode switch inside the root would shadow the app's values again.
6. **Radius.** Roles derive from `--radius` and `--field-radius` by `calc`, as HeroUI's scale does. The contract's `--grammar-radius-*` is defined or deleted: it exists nowhere in the source today.
7. **Type.** `--font-sans` and `--font-mono` everywhere. Sizes, weights and tracking move into one Common token ramp, so 232 literals become one table.
8. **Motion, opacity, scrollbar.** `--disabled-opacity`, `--tooltip-delay`, `--skeleton-animation` and `--scrollbar*` are honoured. The grammar stops forcing `scrollbar-width: none` on every descendant, the reason an app's `--scrollbar` can never show. Durations stay a Common token, since HeroUI has none.
9. **Beyond HeroUI's list, only what it lacks:** `--info*`, derived from `--accent` unless set. `accentText` goes: by the owner's pair rule, accent alone is `--accent`, on its tint `--accent-soft-foreground`.
10. **No gate judges an app's colours.** `status-contrast` goes. An app's theme is the app's decision. A family's defaults are proved in the package's own stories, for the family's sake, and block nothing in an app.

Evidence, from nivo's theme commit `6b8561d43`: `brand-layer-shape` refused the owner's `--scrollbar` because its vocabulary is read from grammar CSS, not HeroUI's, and the app had to write `--starci-core-accent-text` and point private tokens at its set, or parts stayed violet.

Warning for lane 2: HeroUI's mixes differ from Common's (`--success-soft-foreground` is 80/60 there, 50/50 here), so default tints shift when Common stops deriving. Harmless to an app that sets its own; visible in default stories.

### 8.2 Violations

Counts; every line is in [Appendix A](#appendix-a-theming-violations).

| Group | Count |
|---|---|
| Colour literals in component rules or TSX | 10 CSS lines, 5 system-colour mixes, 21 hex fills in RankArtwork, 18 hex in Avatar's bundled palette |
| Colour in token blocks, to move to `theme.css` | 270 lines, with a verbatim duplicate system-dark block in each sheet |
| Radius literals | 28 pill and circle, 17 scale, 8 in Offset Pop, 3 in TS |
| Font and type literals | 232 CSS declarations, 2 raw font stacks, 5 Tailwind classes in Heading |
| Shadows and motion | 19 literal geometries, 5 literal fallbacks, 12 motion lines, 10 opacity lines |
| Tokens overwritten on the root | about 75 of 95 |
| Family token read before HeroUI's | 10 rules, plus all of Offset Pop's sheets |
| HeroUI tokens never read | `--segment*`, `--backdrop`, `--surface-hover`, `--disabled-opacity`, `--ring-offset-width`, `--cursor-*`, `--spacing`, `--scrollbar*`, tooltip delays |
| `*-soft` fixed, not derived | accent in both families, info in Offset Pop |
| Elevation mismatch | Core writes `--shadow-surface`; HeroUI's Card reads `--surface-shadow` |

## 9. The refactor plan

Up to 10 Sonnet lanes, each landing alone (part 10). Each lane raises the package version and changelog in its own commit (CONTRIB-20). Normal commit rules; no loosening.

Order: **1, 2, 3** in sequence, then **4, 5, 6, 7** in parallel, then **8**, then **9, 10**. Each lane has its own worktree. Lanes 4 to 7 touch separate folders and rebase over `renderers*.ts`.

| # | Lane | Files | Migration | Breaks | Done when |
|---|---|---|---|---|---|
| 1 | **Render proof** | `cli/src/harness/dna.ts`, `cli/src/core/dna/*`, `contract.yaml` `mustKeep`, `ops/checks.yaml`, `.github/workflows/ci.yml`, `packages/grammar/scripts/run-plays.mts`, `shoot.cts` | none | a red baseline: laws that never ran will fail, and that list is the first honest report | `dna check` loads, `source` kind and thresholds work, it runs in the grammar's CI across families, modes and widths, a contact sheet is published |
| 2 | **Theme ownership** | `src/common/styles.css`, `src/core/styles.css`, `src/offset-pop/styles.css`, new `theme.css`, `dna.ts`, `GrammarRoot`, `package.json` exports, `packages/stylelint-canon`, templates in `packages/hfs` | nivo-lite: `modules/brand/brand.css` in both apps drops private tokens, `AppLayout` and `SiteLayout` drop `theme`. `app/`: imports `theme.css`. Codemod `theme-tokens` | every app's stylesheet imports; default tints shift | a test app sets HeroUI tokens only and every story follows, in both modes |
| 3 | **Literals and grammar lint** | all of `src/common/*.css`, `src/offset-pop/*.css`, type and radius ramps, `Heading`, `ListBox`, `FlowGraph`, `MermaidDiagram`, `Avatar`; ESLint and Stylelint configs for `packages/grammar`; `policy/quality.yaml` | none | Avatar initials need an owner call | Appendix A empty, grammar lint in CI |
| 4 | **The one card** | `SurfaceCard`, list and accordion cards, `DescriptionList`, `ListRow`, `StaticStateRow`, `surfaceContext`, CSS, contract card role, `wrappers.yaml` and its pin, stories; codemod `surface-card-kinds` in `packages/hfs` | nivo-lite: 94 list cards, 15 figures, 4 joined, 1 accordion, tiles, 12 nested; 30 to 40 by hand. `app/`: 23 uses | every list card import; label pixels | stories match accepted sheets; R355 and R366 on; G-20 closed |
| 5 | **Rows, lists, sections** | `Section` (new), `SectionHeader`, `Region`, `List`, `ListItem`, `LeadingNumber`, `CollectionItem`, `ItemActions`, `ToolbarActions`, `Text`, `Label`; codemod `section-frame` | nivo-lite: 91 headers, 45 regions, 52 lists, about half mechanical. `Text weight`: 195, mostly mechanical to `isStrong`, the heading fakes by hand | those imports | no free heading in apps |
| 6 | **Page and navigation** | `Page`, `PageHeader`, `PageContainer`, `Breadcrumbs`, `FillViewport`, `PrimaryRailLayout`, `Rail`, `FormGrid`, `Grid`, `TopBar`, `NavigationFeatureNav`, remove `Subnav`, `BottomNav`; codemod for the renames | nivo-lite: 9 landing `PageContainer`, 4 rail layouts, 6 form grids, 1 nav. `app/`: 5 `PageHeader`, 10 `PageContainer`, 2 rail | layout frames | R323 to R325 reduce to imports |
| 7 | **Small cuts** | `ChatBubble` rename, `StatusDot`, `ConnectionStatus`, `RankArtwork`, `IncludedMark`, `SurfaceCopyGroup`, `CloseButton`, `TextAction href`, `EmptyNotice`, `DragItem`, `SegmentedControl` sizes, `ButtonGroup` data, `foldForSearch`, field vocabulary (G-19), `variant` out of the types (G-1 to G-5); codemod `small-renames` | nivo-lite: 11 bubbles, 61 text links, 28 segmented reviewed by hand for filter or value, TagGroup selections to `FilterButtonGroup` | those names | R353 clean in nivo-lite |
| 8 | **Tier binding** | folders renamed leaf, branch, composite, frame; `data-tier`; `NoChildren`, `LabelChild` in every public prop type; `hfs/slots.yaml` (`tiers.grammar`, `fe.frames`); `eslint-canon-fe` `tier-children`; `packages/hfs` machine rules; `add-fe-unit` scaffold | nivo-lite: 47 folders with `children` sorted into frames, layouts or slots, each by hand | internal paths, not the public API | Appendix B empty; apps' tier check green |
| 9 | **Whole-program rules and lint set** | `packages/hfs/runtime/scripts/hfs/architecture/` render graph, R355 to R366, rule merges and deletions, `why`, docs, `docs.url`, `rules.yaml` and bundled copies, stale names | apps fix what the graph finds | unknown count: the graph will find the cross-file nesting | every rule in `rules.yaml` with a doc |
| 10 | **Knowledge** | `contract.md`, `contract.yaml`, `ui/components/*`, `ui/composition.md`, `ui/presentation.md`, `ui/proof.md`, `thresholds.yaml`, `code/fe/function.md`, `folder.md`, `architecture.md`, `grammars/*`, `rulings.yaml`, `removedVocabulary`, `open-*.md`, indexes, `search-eval.json` | none | none | no contradiction of part 6 left; this file deleted, its decisions in their owners (CONTRIB-7) |

Per app:

- **nivo-lite:** after the grammar lanes, by codemod then by hand; its lanes are a Kernel's, and this audit touched nothing there. It must first move to 0.20.2: it still pins 0.20.1 and passes TagGroup selection.
- **`app/` in the harness:** migrates with lanes 4 to 7.
- **starci-harness-app (0.12.14), nivo-fe, starci-next-fe (0.7.2), starci-academy-fe (0.5), tayson (0.4):** stay on their pins and run the codemods when they upgrade. `tayson-fe` already imports a subpath that no longer exists. miamia-fe has no grammar source use.

Risks: lanes 4 and 5 move pixels on most screens, so lane 1 is a hard prerequisite. Lane 8 renames folders under every other lane, so it runs after them. If the owner wants half the scope, take lanes 1, 2, 4, 7.

## 10. The owner's decisions

Approved 2026-11-01. These override anything above them.

1. **The plan runs**, lanes 1, 2, 3 in sequence, 4 to 7 in parallel, then 8, 9, 10; grammar first, then nivo-lite on `lane/grammar-refactor`.
2. **`kind="panes"` stays out.**
3. **`ChatBubble` becomes `MessageBubble`**, and the `chat-primary-and-surface` ruling moves with it.
4. **`FlowGraph layout="orbit"` splits into `BubbleMap`.**
5. **Surface in surface is banned totally**, dialogs and drawers included.
6. **A list is a card by default**, except a long list with filter and search, which is `Section`.
7. **Avatar initial colours stay** as identity art; they are not a theming violation.
8. **`Backdrop` goes.**
9. **`components/frames` joins apps.**
10. **Offset Pop's bare-mark exception stays** as a family default.
11. **No gate judges an app's colours.**

Running rule, the owner's: architecture comes before the demo. Each lane migrates and deletes in the same lane and lands alone: the harness
through `release push` after green, nivo-lite main after the hook and a full `app check`, CI green before the next lane. Screens at 1920 and 390
are retaken per lane. No gate is bypassed, and no deploy tag goes out without the owner's word.

## Appendix A. Theming violations

Paths relative to `packages/grammar/src`, at this audit's base. HeroUI's token list is its `themes/default/variables.css` (3.2.6).

### A. Hardcoded colours

#### A(i) inside token default blocks (DNA)
- core/dna.ts:57-100: `accent: "#7547ff"`, `accentForeground: "oklch(100% 0 0)"`, `focus: "#7248ff"`, light {canvas "oklch(97.02% 0.0015 354.13)", ..., accentText "#6a3cf2", accentSoft "oklch(95.5% 0.03 287)"}, dark {..., accentText "#a48bff", accentSoft "oklch(30% 0.07 287)"}
- core/dna.ts:117 `surface: "0 8px 28px oklch(21.03% 0.0059 354.13 / 0.07)"` ; :206-263 TOKEN_DEFAULTS / DARK_TOKEN_DEFAULTS (same literals again)
- core/styles.css:11-31 light (`--starci-core-accent: #7547ff;` `--starci-core-focus: #7248ff;` `--starci-core-accent-text: #6a3cf2;` rest oklch) ; :42 `--starci-core-surface-shadow: 0 8px 28px oklch(21.03% 0.0059 354.13 / 0.07);` ; :46-48 `--starci-core-terminal-background: oklch(20% 0.01 286); -foreground: oklch(92% 0.005 286); -title-foreground: oklch(72% 0.01 286);` ; :100-117 dark ; :170-187 system-dark (duplicate of dark) ; :193-212 forced-colors (system colours)
- offset-pop/dna.ts:74-116 (`accent:"#ff3593"`, `accentForeground:"#1c1524"`, `canvas:"#fff8ef"`, ...), :139-157 (`ink "#1c1524"`, dark `#fff8ef`/`#050306`, palette `#ff3593 #f8d8e6 #ffd447 #91e4ca #e84a5f`), :237-304
- offset-pop/styles.css:16-47 (inks + light theme), :133-151 dark, :470-488 system-dark (duplicate), :498-524 forced-colors
- common/styles.css:92-112 (`--background: oklch(97.02% 0 0); ... --accent: oklch(53% 0.2 256); --backdrop: rgb(0 0 0 / 50%);` shadows `rgb(0 0 0 / 4%)`), :192-210 dark, :228-246 system-dark (duplicate), :264-278 forced-colors

#### A(ii) violations in component rules / TSX
CSS paint literals:
- common/components-forms.css:144 `background: color-mix(in oklab, var(--surface-tertiary, #e4e4e7) 70%, transparent) !important;`
- common/components-forms.css:162 `background-image: linear-gradient(to right, transparent, var(--surface-tertiary, #e4e4e7), transparent);`
- common/components-overlays.css:569 `background: color-mix(in oklab, var(--surface-tertiary, #e4e4e7) 70%, transparent);`
- common/styles.css:1147 `box-shadow: var(--starci-core-surface-shadow, var(--shadow-surface, 0 1px 3px rgb(0 0 0 / 0.16)));`
- common/styles.css:3643 `box-shadow: var(--overlay-shadow, 0 8px 24px rgb(0 0 0 / 0.16)) !important;`
- common/styles.css:4443 `box-shadow: var(--shadow-surface, 0 1px 3px rgb(0 0 0 / 0.16));`
- common/styles.css:4550 `box-shadow: var(--overlay-shadow, 0 8px 24px rgb(0 0 0 / 0.12));`
- common/styles.css:1503 `--starci-core-verdict-edge: inset 2px 0 0 0 var(--success, var(--starci-core-success, #15803d));`
- common/styles.css:1508 `--starci-core-verdict-edge: inset 2px 0 0 0 var(--danger, var(--starci-core-danger, #b91c1c));`
- common/styles.css:2038 `color: var(--success, #15803d);`
- common/styles.css:1128,1129,1132,1133 `linear-gradient(#000 0 0) content-box,` / `linear-gradient(#000 0 0);` (mask alpha, not painted)
- common/styles.css:1244-1248 `--grammar-ink-band-foreground|muted|separator|plate|orbit: oklch(from var(--grammar-ink-band) clamp(0, calc((0.62 - l) * 1000), 1) 0 0)` etc. (relative colour from --accent; derived, with literal constants 0.62, 0.14, 0.08, 0.16, 0.25)
System colours as a mix base (not a fallback, outside forced-colors):
- common/styles.css:1900 `background: var(--muted-surface, color-mix(in srgb, CanvasText 7%, Canvas));`
- common/styles.css:1914 `background: var(--code-surface, color-mix(in srgb, CanvasText 6%, Canvas));`
- common/styles.css:1961 same (6%) ; :1997 same (4%)
- common/styles.css:4139 `box-shadow: 0 1px 2px 0 color-mix(in srgb, CanvasText 8%, transparent);`
Offset Pop component sheets (components-forms/navigation/overlays.css): 0 hex/rgb/oklch literals; all colour is `var(--offset-pop-*)` family tokens (see E.3). Other common group files (avatar-group, list-panel, spacing, surface-controls): 0.
Named colours (`white`, `black`) and Tailwind palette classes (`bg-white`, `text-gray-500`, `bg-black/50`): none in CSS or TSX. TSX colour classes are token classes only: core/primitive/Heading/index.tsx:21 `text-muted`; Badge/index.tsx:32, Button/index.tsx:106, Heading/index.tsx:33 `select-none text-transparent`.
Forced-colors system colours (inside `@media (forced-colors: active)`, legitimate): common/components-forms.css:265,360; components-navigation.css:860,1700,2188-2190; components-overlays.css:916-939; styles.css:1358-1369,3749-3750,4515; offset-pop/components-forms.css:404-416; components-navigation.css:224,231; components-overlays.css:268-270; styles.css:535-537.
TS/TSX:
- core/primitive/RankArtwork/index.tsx:14-46: `fill="#0074BA"` `#00A6ED` `#FFB02E` `#6D4534` `#FCD53F` `#636363` `#BEBEBE` `#E6E6E6` `#D3883E` `#F3AD61` `#402A32` (11 distinct, 21 uses)
- core/branch/MermaidDiagram/theme.ts:73 `context.fillStyle = "#000000"` (canvas reset before token conversion)

### B. Hardcoded radius (component rules)
Literal circle/pill (bypasses `--starci-core-pill-radius` / `--offset-pop-pill-radius`):
- common/components-avatar-group.css:6 `border-radius: 50%;`
- common/components-navigation.css:218,276,549,567,1572,1581,1897,2140 `border-radius: 999px;` ; :738 `border-radius: 9999px !important;` ; :680 `border-radius: 50% !important;` ; :1960,1972,2048 `border-radius: 50%;`
- common/components-overlays.css:275,477,568,601,871 `border-radius: 999px;` ; :729 `border-radius: 999px;` (inline rule) ; :846 `border-radius: 999px;` (inline rule)
- common/styles.css:1899,4171,4213 `border-radius: 999px;` ; :3082 `border-radius: 999px !important;`
- offset-pop/components-forms.css:144,258,263 `border-radius: 999px;` ; offset-pop/components-navigation.css:35,214 `border-radius: 999px;`
Literal scale (rem/px):
- common/components-navigation.css:724 `border-radius: 0.75rem !important;` ; :1608 `border-radius: 0.75rem;` ; :2040 `[data-shape="rect"] { border-radius: 0.25rem; }` ; :2041 `[data-shape="round"] { border-radius: 0.75rem; }` ; :2091 `0.75rem` ; :2160 `0.75rem` ; :2022 `border-radius: min(32px, var(--radius-xl, 1rem));`
- common/styles.css:1913,1960,1996,4285,4441 `border-radius: 0.75rem;` ; :4267 `border-radius: 0.375rem;` ; :4377 `border-radius: 1rem;` ; :4378 `border-start-start-radius: 0.25rem;` ; :4393 `border-start-start-radius: 1rem;` ; :4394 `border-start-end-radius: 0.25rem;`
- offset-pop/components-forms.css:139 `border-radius: 0.25rem;` ; offset-pop/components-overlays.css:182 `border-radius: 0.5rem;` ; offset-pop/styles.css:229 `border-radius: 0.5rem;`
Wrong fallback vs HeroUI default 0.5rem: common/styles.css:3981 `border-radius: var(--radius, 0.25rem);` ; :4121 `.starci-core-text-action-resting { border-radius: var(--radius, 0.25rem); }`
Radius through grammar-invented tokens with literal fallback (app `--radius` has no effect on these):
- `var(--starci-core-surface-radius, 1rem)`: common/components-navigation.css:1716,2202; components-overlays.css:460; styles.css:668,1036,1109
- `var(--starci-core-pill-radius, 999px)`: styles.css:2811,3537,3616,3662,4044,4060
- `var(--starci-core-control-radius, 0.75rem)`: styles.css:3044,4486
- `--grammar-radius-*` does not exist anywhere in src.
Honoured: `var(--field-radius, calc(var(--radius, 0.5rem) * 1.5))` components-forms.css:100,151,601, styles.css:814 ; `var(--radius, 0.5rem)` components-navigation.css:246,521,1026,1369,1511, styles.css:4559 ; `--radius-xs|sm|lg|xl`: styles.css:864,2800,3685,3691,3731,3803,4067,4547 ; styles.css:3457 `calc(var(--radius) * 3)`. `--radius-*` are Tailwind @theme variables (theme.css:104-111); at runtime they exist only if the app's Tailwind build emits them, otherwise the literal fallback applies.
Token default radii: core/styles.css:39-41 `--starci-core-surface-radius: 1rem; --starci-core-control-radius: 0.75rem; --starci-core-pill-radius: 999px;` ; offset-pop/styles.css:55-57 (`1.5rem`,`1rem`,`999px`), :448 `--offset-pop-surface-radius: 1.25rem;` ; core/styles.css:88-89 `--radius: var(--starci-core-control-radius); --field-radius: var(--starci-core-control-radius);` ; offset-pop/styles.css:97-98. The Common root writes neither `--radius` nor `--field-radius`.
TS/TSX:
- core/primitive/Skeleton/index.tsx:62 `className={shape === "circle" ? "starci-core-skeleton rounded-full" : "starci-core-skeleton"}`
- core/branch/FlowGraph/index.tsx:254 and :565 `labelBgBorderRadius: 4` ; :242 `const LANE_RADIUS = 14`
- core/primitive/Avatar/index.tsx:70 `borderRadius: STARCI_CORE_DNA.avatar.borderRadius` (DNA literal 0)

### C. Hardcoded font
HeroUI has no font token. Grammar reads Tailwind `--font-sans` / `--font-mono` with literal stacks:
- core/styles.css:95 `font-family: var(--font-sans, ui-sans-serif, system-ui, sans-serif);` (only under family=core; Common and offset-pop set none)
- common/styles.css:1444,4257,4270,4303 `font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace);`
Literal stacks (no variable):
- common/styles.css:1902 `font: 500 0.875rem/1.4 ui-monospace, SFMono-Regular, Consolas, monospace;`
- common/styles.css:1925 `font: 400 0.875rem/1.6 ui-monospace, SFMono-Regular, Consolas, monospace;`
- core/branch/MermaidDiagram/theme.ts:100 `fontSize: "14px"`
Literal size / weight / line-height / tracking declarations (no type-scale token exists). Per file: common/styles.css 109, components-navigation 55, components-forms 15, components-overlays 11, components-avatar-group 5, offset-pop/components-forms 11, offset-pop/components-navigation 12, offset-pop/components-overlays 6, offset-pop/styles.css 8.
common lines:
 avatar-group: 66,80,81,82
 forms: 34,35,36,48,49,54,55,56,76,107,231,232,401,630,661
 navigation: 279,280,343,344,349,354,525,526,570,571,572,638,639,663,787,788,789,797,798,997,1063,1064,1150,1151,1163,1164,1165,1177,1178,1179,1189,1190,1321,1342,1343,1646,1647,1648,1654,1901,1902,1925,1926,1927,1975,1976,1977,2026,2027,2106,2107,2108,2131,2143,2145
 overlays: 161,162,335,336,491,492,493,500,501,825,826
 styles.css: 344-346,352-353,358-361,368-369,380,389-390,468-469,476-477,855,869-870,1022-1024,1028-1029,1447,1449,1534-1535,1673,1687-1688,1847-1848,1868-1869,1902,1925,2359,2671,2776-2777,2837-2838,3047-3048,3289-3290,3294-3295,3433-3434,3611-3612,3666-3669,3840,3863-3866,3870-3872,3876-3878,3882-3884,3888-3891,3897-3899,3903-3904,3908-3909,3913-3914,4026,4031,4047,4086,4098,4103,4192-4193,4271,4294-4295,4304-4305,4366-4367,4381-4382,4493-4495,4499-4500,4507-4508
 exact examples: styles.css:344 `font-size: 1.25rem;` ; :3888 `font-size: 2.25rem !important;` ; :3913 `font-size: 1.875rem;` ; :360 `letter-spacing: 0.08em;` ; components-navigation.css:570 `font-size: 0.6875rem;` ; :1927 `letter-spacing: 0.04em;`
offset-pop lines (family DNA, but literal): components-forms.css 23,24,29,45,197,318,325,339,365,366,371 (`font-weight: 800|900|700;` `letter-spacing: -.01em|-.015em;`) ; components-navigation.css 11,29,47,65,85,105,137,165,166,183,195,217 ; components-overlays.css 89,90,110,156,186,247 ; styles.css 158-160 (`font-weight: 900; letter-spacing: -.045em; line-height: .96;`),197,209,215,314,315
TSX Tailwind type classes (Tailwind scale, not an app/HeroUI token):
- core/primitive/Heading/index.tsx:18 `"text-xl font-semibold tracking-tight"` ; :19 `"text-base font-semibold"` ; :20 `"text-sm font-medium"` ; :21 `"text-xs font-medium text-muted"` ; :24 `"text-4xl font-semibold leading-tight tracking-tight"`
- core/primitive/Text/index.tsx:67-68 mention `font-medium` / `font-semibold` in a comment; weights come from CSS `data-weight` (styles.css:3897-3914)
- Inline style: core/branch/ListBox/index.tsx:131,158 `style={item.emphasis === "unread" ? { fontWeight: presentation.unreadWeight } : undefined}`; `unreadWeight` is a DNA literal `600` (core/dna.ts:49, offset-pop/dna.ts:62)

### D. Shadows and motion
Shadows with literal geometry (not via a token):
 common: components-forms.css:251 `box-shadow: 0 0 0 2px var(--focus, Highlight);` ; :355 same ; components-navigation.css:685 `box-shadow: 0 0 0 1px var(--surface, Canvas);` ; :1117-1120 stat-strip `calc(-1 * var(--starci-core-strip-line-width)) 0 0 0 ...` ; styles.css:2825 `box-shadow: 0 0 0 2px var(--accent, var(--starci-core-accent, Highlight));` ; :3665 `box-shadow: 0 0 0 2px var(--background, Canvas);` ; :4139 `box-shadow: 0 1px 2px 0 color-mix(in srgb, CanvasText 8%, transparent);` ; :4221 `box-shadow: 0 0 0 1.5px var(--starci-core-status-dot-light);`
 literal fallbacks: components-overlays.css:463 `0 8px 28px color-mix(in srgb, var(--foreground, CanvasText) 12%, transparent)` ; styles.css:1147,3643,4443,4550 (see A)
 offset-pop literal geometry (own units, not --offset-pop-shadow-x/y): components-forms.css:319 `inset 0.25rem 0 0 var(--offset-pop-pink)` ; components-navigation.css:76,111,150 `0.125rem 0.1875rem 0 var(--offset-pop-shadow-ink)` ; :176 `0 0 0 var(--offset-pop-outline-width) var(--offset-pop-pink), 0.125rem 0.1875rem 0 ...` ; components-overlays.css:155 `0.25rem 0.25rem 0 var(--offset-pop-shadow-ink)` ; :185 `0 2px 0 var(--offset-pop-shadow-ink)` ; styles.css:196 `0.25rem 0.25rem 0 var(--offset-pop-shadow-ink)` ; :361 `0.125rem 0.125rem 0 ...` ; :402 `0.25rem 0.25rem 0 ...` ; :427 `inset 0.25rem 0 0 var(--offset-pop-state-color, transparent)` ; `transform: translate(0.25rem, 0.25rem)` / `translate(0.125rem, 0.125rem)` in styles.css (active states)
 through tokens: `var(--field-shadow, none)` components-forms.css:105, styles.css:818 ; `var(--surface-shadow, none)` components-navigation.css:1999 ; `var(--overlay-shadow, none)` :2024 ; offset-pop `var(--shadow-surface)` components-forms.css:293, styles.css:266 ; offset-pop forms/navigation/overlays lines using `var(--offset-pop-shadow-x|y)`.
Disabled opacity (HeroUI `--disabled-opacity` has 0 reads): literal `opacity: 0.5` at components-forms.css:116,654 ; components-navigation.css:534,757,848,1495 ; components-overlays.css:630 ; styles.css:841,2829,4016 ; `0.6` navigation:260 ; `var(--starci-core-disabled-opacity, 0.55)` styles.css:1434.
Motion literals:
- components-forms.css:164 `animation: skeleton 2s linear infinite;`
- components-navigation.css:1354 `transition: transform var(--starci-core-motion-duration, 180ms) ease;` ; :1401 `transition: opacity var(--starci-core-motion-duration, 180ms) ease;` ; :1964 `transition: opacity 0.2s ease;`
- components-overlays.css:674 `animation: starci-core-spin 0.8s linear infinite;` ; :803 `animation: starci-core-spin 1s linear infinite;` ; :907 `animation: starci-core-pulse 1.6s ease-in-out infinite;`
- styles.css:920 `transition: opacity 150ms var(--ease-smooth);` ; :1135 `animation: starci-core-highlight-spin 3s linear infinite;` ; :3733 `transition: background-color var(--starci-core-motion-duration, 150ms) cubic-bezier(0.4, 0, 0.2, 1);` ; :4223 `animation: starci-core-status-dot-echo 1.6s ease-out infinite;` ; :4430 `transition: opacity var(--starci-core-motion-duration, 150ms) cubic-bezier(0.4, 0, 0.2, 1);` ; :1406 `... var(--starci-core-motion-easing, ease-out)`
- Token + literal fallback (HeroUI has no duration token): `var(--starci-core-motion-duration, 180ms) var(--starci-core-motion-easing, cubic-bezier(0.2, 0, 0, 1))` at components-forms.css:607-608 ; components-navigation.css:734 ; components-overlays.css:66,70,116,280,284,288,292,328,464,799 ; styles.css:823-824,2718,4141
- offset-pop: every transition via `var(--offset-pop-transition)` (styles.css:67 composite, 378-383; components-forms 66,131,186,227,271,303,340); reduced motion zeroes it (styles.css:454-455). Common and Core have no equivalent single reduced-motion switch for the `--starci-core-motion-*` tokens (not audited beyond grep).
- TS timings (behavioural): core/branch/CopyField/index.tsx:123 COPIED_MS ; core/primitive/Input/index.tsx:140 `setTimeout(..., 2000)` ; core/primitive/TextAction/index.tsx:204 `300` ; core/branch/FlowGraph/index.tsx:265,267,329 `duration: 0` ; core/branch/Toast/index.tsx:108-121 `toastTimeoutFor`
- HeroUI `--tooltip-delay` / `--tooltip-close-delay`: 0 reads; core/primitive/StatusDot/index.tsx:101 and core/branch/CopyField/index.tsx:175 pass `<HeroTooltip delay={0}>`.

### E. Honoured / overwritten / ignored

#### E.1 Direct answer
If the app sets `--accent` (etc.) on `:root`, `.light`, `.dark` or `[data-theme]`: the grammar overrides it.
- Mechanism: the grammar writes the same custom properties on the element `.grammar-common-root` itself. A property declared on an element beats the value inherited from any ancestor, regardless of specificity or layer, so `:root{--accent:X}` never reaches anything inside a GrammarRoot for any token listed below.
- Common root writes ~75 HeroUI tokens unconditionally (not "only when absent"): common/styles.css:89-168 light; :189-221 dark; :224-257 system; :262-278 forced-colors (selector `.grammar-common-root[data-grammar-theme]`, specificity 0,2,0).
- Family scope writes them again: core/styles.css:8 `.grammar-common-root[data-grammar-family="core"]` (lines 51-90); offset-pop/styles.css:27 `.grammar-common-root[data-grammar-family="offset-pop"]` (lines 70-120).
- Layers: common/styles.css:2 `@layer starci-grammar-common, starci-grammar-core, starci-grammar-offset-pop;` (later wins). HeroUI's variables sit in `@layer base` nested in `layer(theme)`. If the app puts `.dark`/`data-theme` on the SAME element as the grammar root, layer order decides; the starci layers are declared after Tailwind's `theme, base`, so the grammar wins there too. Specificity: Common 0,1,0; family 0,2,0.
- What beats the grammar: unlayered app CSS targeting `.grammar-common-root`, or inline `style` on GrammarRoot (props are spread at core/primitive/GrammarRoot/index.tsx:34). The token declarations themselves carry no `!important` (198 `!important` elsewhere).
- Dark mode: the only switch is the GrammarRoot `theme` prop -> `data-grammar-theme` (GrammarRoot/index.tsx:29,40; default "system" follows prefers-color-scheme). No selector in src reads `.dark`, `.light` or `[data-theme]` except React Flow's own classes (common/components-navigation.css:1760-1761). An app's HeroUI `.dark` class does not change grammar colours.
- JS injection: none. GrammarRoot adds no `style`. `STARCI_CORE_TOKEN_DEFAULTS` / `STARCI_CORE_DARK_TOKEN_DEFAULTS` (core/dna.ts:206,244; exported core/index.ts:21-24) and `OFFSET_POP_TOKEN_DEFAULTS` / `OFFSET_POP_DARK_TOKEN_DEFAULTS` (offset-pop/index.tsx:18-21) are exported data, never applied inside src; they duplicate the CSS literals (offset-pop/dna.ts:9 "Every value equals the default in ./styles.css").
- DNA writes `--accent` under `[data-grammar-family=...]`: core/styles.css:51 `--accent: var(--starci-core-accent);` -> `#7547ff` (:11); offset-pop/styles.css:70 `--accent: var(--offset-pop-accent);` -> `#ff3593` (:28). Element-level re-declarations: core/styles.css:128-130 `:is(.starci-core-link, ...current tab, .starci-core-bottom-nav-item[data-grammar-current]) { --accent: var(--starci-core-accent-text); }` ; :132-134 `.starci-core-section-eyebrow { --starci-core-accent: var(--starci-core-accent-text); }` ; offset-pop/styles.css:190 `--accent: var(--offset-pop-accent-text);`
- Setting `--starci-core-accent` on `:root` is also overwritten (core/styles.css:11 re-declares it on the root element). Core's inputs are the `--starci-core-*` names, applied at or below `.grammar-common-root`; HeroUI names are outputs.
- Re-inherit hack: common/components-navigation.css:1762-1828 `--accent: inherit; ...` for React Flow's stamped `.light/.dark` class.
- Nested HeroUI scope inside bare Common (no family): not written tokens (`--radius`, `--field-radius`, `--border-width`, `--disabled-opacity`, ...) DO come from the app's `:root`.

#### E.2 Per token
W-C = Common root (common/styles.css) ; W-core = core/styles.css ; W-op = offset-pop/styles.css ; R = count of `var(--x)` reads in src (includes root derivations).
| token | writer | R | app :root wins? |
|---|---|---|---|
| --background | W-C:92; W-core:54; W-op:73 | 12 | no |
| --foreground | W-C:93; W-core:55; W-op:74 | 106 | no |
| --surface | W-C:94; W-core:56; W-op:75 | 67 | no |
| --surface-foreground | W-C:117; W-core:57; W-op:76 | 17 | no |
| --surface-secondary (+-foreground) | W-C:95,118; W-core:58-59; W-op:77-78 | 16 / 0 | no |
| --surface-tertiary (+-foreground) | W-C:119-120 mix(surface-secondary 98%, foreground); Core deliberately does not write it (core/styles.css:63-67, publishes `--starci-surface-tertiary`); op none | 3 (all with `#e4e4e7` fallback) / 0 | no |
| --surface-hover | W-C:134 | 0 | no |
| --overlay (+-foreground) | W-C:121-122 =surface; families none | 2 / 2 | no |
| --muted | W-C:96; W-core:70; W-op:82 | 78 | no |
| --accent | W-C:99; W-core:51; W-op:70 | 48 | no |
| --accent-foreground | W-C:100; W-core:52; W-op:71 | 17 | no |
| --segment (+-foreground) | W-C:125-126 =surface (dark :211 mix) | 0 / 0 | no; unread by grammar CSS |
| --border / --separator | W-C:97-98; W-core:71-72; W-op:83-84 | 44 / 39 | no |
| --focus | W-C:115 =accent; W-core:53 literal `#7248ff`; W-op:72 | 28 | no |
| --link | W-C:116 =foreground; W-core:83 =accent-text; W-op:120 | 1 | no |
| --default (+-foreground) | W-C:123-124 mix; W-op:106 =surface-secondary; core none | 20 / 2 | no |
| --success / --warning / --danger (+-foreground) | W-C:101-106; W-core:73-78; W-op:85-90 | 24/24/37 (+6/4/8) | no |
| --info (+-foreground) [not HeroUI] | W-C:107-108 =accent; W-core:79-80; W-op:91-92 | 17 / 1 | n/a |
| --backdrop | W-C:109 `rgb(0 0 0 / 50%)`, dark :207 `/ 60%` | 0 | no; unread by grammar CSS |
| --surface-shadow / --overlay-shadow / --field-shadow | W-C:110-112 literals (dark :208-210); families do not write | 1 / 3 / 2 | no |
| --shadow-surface (Tailwind alias) | W-core:90 `=--starci-core-surface-shadow`; W-op:99 | 6 | HeroUI cards read `--surface-shadow` (card.css `@apply shadow-surface` -> theme.css:45), which Core does not set: Core's elevation reaches only grammar rules that read `--shadow-surface` / `--starci-core-surface-shadow` |
| --field-background / -foreground / -placeholder / -border | W-C:127-130; W-core:84-87; W-op:93-96 (`--field-border: var(--offset-pop-border)`) | 7/5/1/5 | no |
| --field-hover / -focus / -border-hover / -border-focus | W-C:140-143 | 1/0/1/0 | no |
| --radius / --field-radius | not written by Common; W-core:88-89; W-op:97-98 | 23 / 4 | bare Common: yes; with family: no |
| --field-border-width, --border-width | not written | 2 / 0 | yes |
| --disabled-opacity, --ring-offset-width, --cursor-*, --spacing, --white/--black/--snow/--eclipse | not written | 0 | yes, never read |
| --scrollbar, --scrollbar-gutter, --scrollbar-width | not written | 0 | n/a: common/styles.css:293-301 forces `scrollbar-width: none` and `::-webkit-scrollbar{display:none}` on root and all descendants |
| --scrollbar-thumb / -track / -color | W-C:131-133 | 1 / 1 / 0 | no |
| --background-secondary / -tertiary / -inverse | W-C:162-164 | 0 | no; unread |
| --default-hover | W-C:135 | 1 | no |
| --accent / success / warning / danger -hover | W-C:136-139 + `@supports` relative-colour override :179-185 | 0 (HeroUI's own components read them) | no |
| --*-soft, --*-soft-foreground, --*-soft-hover | see F | accent-soft 16, -fg 11; danger-soft 8, -fg 5, -hover 2; warning-soft 4/4; success-soft 4/3; info-soft 2/2; default-soft 8/1 | no |
| --separator-secondary / -tertiary, --border-secondary / -tertiary | W-C:165-168 | 0 | no; unread |
| --skeleton-animation, --tooltip-delay, --tooltip-close-delay | not written | 0 | yes, never read |
| --radius-xs/sm/md/lg/xl/2xl/3xl/4xl | Tailwind theme | 1/2/0/2/4/0/0/0 | depends on app Tailwind |
| --ease-smooth | Tailwind theme | 1 (styles.css:920) | n/a |

#### E.3 Rules that read the family token first (HeroUI token ignored)
common/styles.css:
- :341 `color: var(--starci-core-foreground, var(--foreground, CanvasText));`
- :357 `color: var(--starci-core-accent, var(--accent, Highlight));`
- :367,379,388 `color: var(--starci-core-muted, var(--muted, GrayText));`
- :667 `border: 1px solid var(--starci-core-border, var(--border, GrayText));` ; :669 `background: var(--starci-core-surface-secondary, var(--surface-secondary, Canvas));`
- :1124 `var(--starci-core-accent, var(--accent, Highlight)) 92%,`
- :1147 `box-shadow: var(--starci-core-surface-shadow, var(--shadow-surface, ...))`
- :1415 `background: color-mix(in oklab, var(--starci-core-accent, Highlight) 14%, var(--starci-core-surface, Canvas));`
components-overlays.css:463 same `--starci-core-surface-shadow` pattern. Radius: see B.
Rules that read HeroUI first with the family token as second fallback: styles.css 592,605,835,863,866,1075,1779,2190,2192,2327-2329,2501,2660,2707,2717,2778,2801,2815,2820-2825,2874,2901-2902,3006,3021,3033,3043-3046,3081-3084,3198-3199,3288,3474,3696-3702,3789,3896,3918-3939,4025-4107,4145 ; components-navigation.css 219,275,752,1918,2151,2179,2221.
Offset Pop component rules read only family tokens (no HeroUI colour fallback). Palette/semantic family reads: components-forms.css 18,28,40,44,64,104,109,129,154,159,176,184,201,205,210,259,264,269,292,307,317,319,324,338,348,349,359,370 ; components-navigation.css 12,23,51,69-70,74,80,115,148,155,176,181,203 ; components-overlays.css 12,37,41,120,124,172,201,259 ; styles.css 169,174,179,180,190,230,241,299-301. Ink: `var(--offset-pop-ink)` forms 28,40,44,61,63,90,128,152,158,182,194,201,214,257,268,289,291,329,335,337,370 ; navigation 34,43,90,97,109,129,147,154,156,161,172,180,182,188,194,213 ; overlays 81,124,173,196,234 ; styles 62,220,228,231,239,293,295-298,302. `var(--offset-pop-shadow-ink)` forms 14,91,97,130,171,185,219,226,246,270,283,350,355 ; navigation 53,76,111,131,150,176,190 ; overlays 41,49,65,69,73,77,155,185,259 ; styles 58,196,361,365,386,402.
Local override of a HeroUI token inside a family component rule: offset-pop/components-forms.css:40 `--danger: color-mix(in srgb, var(--offset-pop-critical) 65%, var(--offset-pop-ink));`

### F. `*-soft` pairs
Common root derives every pair from the in-scope semantic value with color-mix, on the root element (common/styles.css). It is "always derive", not "derive when absent": there is no `var(--x-soft, color-mix(...))` form, and an app-supplied `--x-soft` on `:root` is shadowed by this declaration.
| pair | Common light | Common dark | Core | Offset Pop |
|---|---|---|---|---|
| default-soft / -foreground / -hover | 144-146: mix(default 50% / 60%), =default-foreground | not re-declared (same-element light form applies) | derived (no write) | derived (no write); `--default` itself FIXED =surface-secondary (styles.css:106) |
| accent-soft | 147 `color-mix(in oklab, var(--accent) 15%, transparent)` | 212 (16%) | FIXED core/styles.css:81 `--accent-soft: var(--starci-core-accent-soft);` = `oklch(95.5% 0.03 287)` (:31); dark `oklch(30% 0.07 287)` (:117) | FIXED offset-pop/styles.css:115 `=--offset-pop-accent-soft` `#f8dbe8` (:47); dark `#3b2936` (:151) |
| accent-soft-foreground | 148 `mix(accent 70%, foreground 30%)` | 213 | FIXED core/styles.css:82 `=--starci-core-accent-text` `#6a3cf2` (:30) / `#a48bff` (:116) | FIXED offset-pop/styles.css:116 `=--offset-pop-accent-text` `#b8005f` / `#ff7ab8` |
| accent-soft-hover | 149 `mix(accent-soft 94%, accent)` | inherits | derived from the fixed accent-soft | same |
| success-soft / -foreground / -hover | 150-152 (15%; fg 50/50; hover 20%) | 214-215 (14%; fg 70/30) | derived from `--success` | derived; ink-band override offset-pop/styles.css:299 `--success-soft-foreground: color-mix(in oklab, var(--offset-pop-mint) 45%, var(--offset-pop-canvas));` |
| warning-soft ... | 153-155 (fg 45/55) | 216-217 | derived | derived; :300 ink-band override |
| danger-soft ... | 156-158 (fg 65/35) | 218-219 | derived | derived; :301 ink-band override; light mark hooks :122-123 `--starci-core-mark-danger: var(--danger-soft-foreground);` |
| info-soft / -foreground / -hover | 159-161 from `--info` | 220-221 | derived from `--info` (core/styles.css:79) | FIXED offset-pop/styles.css:118-119 `--info-soft: var(--offset-pop-accent-soft); --info-soft-foreground: var(--offset-pop-accent-text);` |
System-dark block repeats the dark pairs (common/styles.css:248-257). `treatment="ink"` (common/styles.css:1262-1267) re-mixes `--*-soft-foreground` to 8% tone in the band foreground and sets `--accent-soft: var(--grammar-ink-band-plate)`; `treatment="soft"` (:1219) sets `--surface: var(--accent-soft, Canvas)`.
Common's percentages differ from HeroUI's (e.g. success-soft-foreground HeroUI `mix(success 80%, foreground 60%)`, Common light `50%/50%`), so the grammar does not reproduce HeroUI's pair.
Consumers: components-overlays.css:17-49 (`--starci-core-overlay-soft*`), :534-552 (`--starci-core-alert-soft`) ; components-navigation.css:298,553,940-941,1034,1888-1944 ; styles.css:2820-2821,3701-3702,3922,3939,4092-4102 ; MermaidDiagram/theme.ts:47-50.

### G. Tokens the grammar invents (app dependency)
| token | defined | derives from HeroUI? |
|---|---|---|
| `--starci-core-{accent,accent-foreground,focus,canvas,surface,surface-secondary,surface-tertiary,foreground,muted,border,separator,success(+fg),warning(+fg),danger(+fg),info(+fg),accent-text,accent-soft}` (core/dna.ts:136-157) | core/styles.css:11-31, dark :100-117 | NO. Own literals (hex/oklch). HeroUI tokens are derived FROM these (core/styles.css:51-87): reverse of the stated rule |
| `--starci-core-{page-measure,reading-measure}` | core/styles.css:32-33 | literal `80rem`, `72ch` |
| `--starci-core-{surface-radius,control-radius,pill-radius}` | core/styles.css:39-41 | literal `1rem` / `0.75rem` / `999px`; `--radius` derives from control-radius (reverse) |
| `--starci-core-{page-inset,region-gap,section-gap,inline-gap,row-gap}` | core/styles.css:34-38 | from `--grammar-*` (grammar's own literals) |
| `--starci-core-surface-shadow` | core/styles.css:42 | literal `0 8px 28px oklch(21.03% 0.0059 354.13 / 0.07)` |
| `--starci-core-motion-duration` / `-easing` | core/styles.css:43-44 | literal `180ms`, `cubic-bezier(0.2, 0, 0, 1)`; read 22 / 18 times with the same literal as fallback; not defined in bare Common |
| `--starci-core-terminal-*`, `--terminal-background/-foreground/-title-foreground` | core/styles.css:46-48,60-62; offset-pop/styles.css:61-64,79-81 | Core: own oklch literals; Offset Pop: from family inks; Common fallback `CanvasText` / `Canvas` (styles.css:4286-4293) |
| `--starci-surface-tertiary(-foreground)` | core/styles.css:68-69 | from `--starci-core-surface-tertiary` (own literal) |
| `--info`, `--info-foreground`, `--info-soft*` | common/styles.css:107-108,159-161 | `--info: var(--accent)` default (derives); not a HeroUI token; read 17 / 1 / 2 times |
| `--starci-core-mark-danger/-warning` | offset-pop/styles.css:122-123,152-153 | op light: from `--danger-soft-foreground`; otherwise unset (fallback `var(--danger)`) |
| `--starci-core-disabled-opacity` | read common/styles.css:1434 | never defined; literal fallback `0.55`; HeroUI `--disabled-opacity` (0.5) unread |
| `--muted-surface`, `--code-surface` | read common/styles.css:1900,1914,1961,1997 | never defined; fallback `color-mix(in srgb, CanvasText 6%, Canvas)` (system colours) |
| `--starci-core-band-offset/-height/-subnav-height`, `-rail-offset`, `-subnav-offset` | core/dna.ts:192-198; common sheets | geometry; published by Common |
| `--starci-core-{rail-compact,rail-standard,rail-wide,top-bar-z,navbar-z,bottom-nav-*,workspace-*,sidebar-*,form-measure,form-compact-measure,control-min-size,field-min-height,field-gap,row-inset,grid-*,copy-gap,status-dot-size}` | various common sheets | layout literals |
| `--grammar-{identity,inline,row,section,region}-gap`, `--grammar-inset(-nested,-open)`, `--grammar-page-inset`, `--grammar-card-padding-*`, `--grammar-overlay-inset`, `--grammar-pane-inset-*`, `--grammar-control-padding-*`, `--grammar-mascot-*`, `--grammar-accent-corner` | common/styles.css:12-62 | literal rem; HeroUI `--spacing` is unread (0 reads) |
| `--grammar-ink-band*` | common/styles.css:1243-1248; offset-pop/styles.css:293-298 | Common: derived from `--accent` by relative colour; Offset Pop: from `--offset-pop-ink/canvas` |
| `--offset-pop-{pink,blush,yellow,mint,critical,ink,shadow-ink,outline-width,shadow-x,shadow-y,transition,motion-*,tone-color,state-color,field-ring}` + the 36 semantic names (offset-pop/dna.ts:167-211) | offset-pop/styles.css:16-67 | own literals; HeroUI tokens derived FROM them |
| DNA keys `accentSoft`, `accentText` | core/dna.ts:78-79,98-99; offset-pop/dna.ts:94-95,113-114 | own literals, unrelated to `--accent` (Core: hand-tuned violet for AA) |

### H. JS-side colour
- MermaidDiagram: core/branch/MermaidDiagram/theme.ts:40-51 reads `--surface, --surface-secondary, --foreground, --muted, --border, --separator, --accent-soft, --accent-soft-foreground, --accent, --warning-soft` (resolved in-page via probe, converted to hex through a canvas; system-colour fallbacks). Honours tokens and the app's overrides at the root. Literals: :73 `"#000000"` (reset), :100 `fontSize: "14px"`. `darkMode` from luminance of `--surface` (:96). Reads no `--success`, `--danger`, `--info`; Mermaid's own palette supplies those. Re-renders on root attribute change (MermaidDiagram/index.tsx:101).
- FlowGraph: core/branch/FlowGraph/index.tsx:127-134 `TONE_PAINT = { neutral:"var(--muted, GrayText)", accent:"var(--accent, Highlight)", success:"var(--success, CanvasText)", warning, danger, info:"var(--info, CanvasText)", muted:"color-mix(in oklab, var(--muted, GrayText) 55%, transparent)" }` ; :560 `markerEnd: { type: MarkerType.ArrowClosed, width: 24, height: 24, color: "var(--muted, GrayText)" }` ; :183 ring conic gradient from TONE_PAINT. Token-driven. Literals: :254,:565 `labelBgBorderRadius: 4`, :242 `LANE_RADIUS = 14`, :560 marker `24`. CSS node tints: common/components-navigation.css:1888-1944,1984.
- Terminal: core/primitive/Terminal/index.tsx has no colour; common/styles.css:4286-4293 reads `--terminal-*` (bare-Common fallback `CanvasText` / `Canvas`). Core's dark console is oklch literals (core/styles.css:46-48).
- Avatar: core/primitive/Avatar/index.tsx:3-4,45-82 uses `@dicebear/core` + `@dicebear/styles/initials.json` (node_modules/@dicebear/styles/src/initials.json): 18 hard-coded background hex (#2a7e7e #2b8248 #2b8265 #2d862d #347a9d #48822b #4b73c3 #627e2a #6a6acd #777728 #825ec9 #8e6e2f #9f53c6 #ac6039 #bb3ebb #c14497 #c34b73 #c44f4f) with #000000 / #ffffff text, picked by `seed ?? name` (:71). No palette is passed in, the result is a `data:` image CSS cannot restyle; the file comment says contrast is independent of page theme. `borderRadius: STARCI_CORE_DNA.avatar.borderRadius` (:70). Avatar imports `STARCI_CORE_DNA` directly (not family-aware).
- RankArtwork: core/primitive/RankArtwork/index.tsx:14-46, 11 distinct hex fills (A(ii)); fixed art, not themeable.
- Mascot: core/primitive/Mascot/index.tsx: no colour; `<Image>` asset; sizes from `--grammar-mascot-*`.
- Charts / canvas drawing: none in src (only the Mermaid colour-probe canvas).
- DragItem: core/branch/DragItem/index.tsx:16,20,29 `leadingColor?: string` written to inline `--starci-drag-item-leading` (app-supplied colour string).
- Family-aware JS: core/buttonIntent.tsx:28-33 and core/collectionItem.tsx:15-19 pick `OFFSET_POP_DNA` or `STARCI_CORE_DNA` by `data-grammar-family`; any other family string gets Core's DNA.


## Appendix B. Tier violations

Grammar facts by folder, measured by script (children and className include spread element props). The target tier of each is in part 5.

**primitive (53):** children 23, ReactNode-slot 16, className 20, state 4, effects 4, heroui 30, grammar-deps 26, upward 3.

- Take children: Avatar Badge Button Code DateField Field GrammarRoot Heading Label Link List ListItem MediaFrame NavLandmark PageContainer PinnedActionBar PlainPressable Region Skeleton StatusDot SurfaceCopyGroup Text TextAction
- Take className: Avatar GrammarRoot Icon Image IncludedMark Input Link List ListItem Mascot MediaFrame NavLandmark PageContainer PlainPressable RankArtwork Rating Region SectionHeader SurfaceCopyGroup Video
- Hold state: FileDropzone Input Rating Textarea
- No vendor part, no grammar import (a bare element): GrammarRoot Image IncludedMark Label List ListItem NavLandmark PageContainer PinnedActionBar RankArtwork Rating Region SurfaceCopyGroup Video
- Upward imports: Button->Tooltip(branch) MediaFrame->SurfaceCard(branch) StatusDot->Tooltip(branch)
- Over 12 prop lines: Avatar:13 Button:26 Field:27 IconButton:13 Image:16 Input:31 SearchField:15 StatusDot:13 Text:14 TextAction:21 Textarea:22

**composite (31):** children 15, ReactNode-slot 16, className 9, state 3, effects 3, heroui 13, grammar-deps 22, upward 0.

- Take children: Backdrop ButtonGroup ChatBubble CollectionItem Fieldset FillViewport Form FormGrid Freestyle HorizontalScrollRegion ItemActions ListRow Quote ToolbarActions VerticalScrollRegion
- Take className: AvatarGroup Backdrop Breadcrumbs DescriptionList Freestyle Pagination Stepper TagGroup Timeline
- Hold state: Alert FilterButtonGroup TagGroup
- No vendor part, no grammar import (a bare element): CollectionItem FillViewport FormGrid Freestyle ItemActions StaticStateRow ToolbarActions
- Over 12 prop lines: Alert:14 AvatarGroup:13 ChatBubble:13 DescriptionList:13 FilterButtonGroup:14 Stepper:15 TagGroup:22 Timeline:14

**branch (27):** children 12, ReactNode-slot 19, className 8, state 7, effects 7, heroui 16, grammar-deps 18, upward 4.

- Take children: AlertDialog DataTable Dialog Disclosure DragItem Drawer MarkdownArticle Popover Rail SurfaceCard SurfaceListCard Tooltip
- Take className: Accordion Calendar DataTable Disclosure FlowGraph ListBox MermaidDiagram Subnav
- Hold state: AlertDialog CopyField Disclosure FlowGraph MermaidDiagram Tabs Toast
- No vendor part, no grammar import (a bare element): DragItem Rail Subnav Tabs Tooltip
- Upward imports: MermaidDiagram->Alert(composite) SurfaceAccordionCard->VerticalScrollRegion(composite) SurfaceCard->VerticalScrollRegion(composite) SurfaceListCard->ListRow(composite),StaticStateRow(composite),VerticalScrollRegion(composite)
- Over 12 prop lines: ComboBox:15 CopyField:15 DataTable:42 DropdownMenu:27 FlowGraph:86 ListBox:27 MarkdownArticle:13 MermaidDiagram:38 Rail:15 Select:13 SurfaceAccordionCard:30 SurfaceCard:34 SurfaceListCard:16 Tabs:14 Toast:24

**composition (14):** children 7, ReactNode-slot 8, className 9, state 0, effects 2, heroui 2, grammar-deps 10, upward 0.

- Take children: Cluster Footer Grid Page PaneGrid PaneSection Stack
- Take className: BottomNav Footer NavigationFeatureNav Page PageHeader PaneGrid PrimaryRailLayout TopBar WorkspaceShell
- No vendor part, no grammar import (a bare element): BottomNav PrimaryRailLayout Stack
- Over 12 prop lines: BottomNav:14 Footer:15 PageHeader:15 PaneGrid:38 Sidebar:26 WorkspaceShell:16

**nivo-lite** (`apps/web`, 617 folders; `useState` in composites 3, in branches 1, in blocks 53 is allowed).

- Leaves taking `children` (4): AccountingBlock, AccountingHeadLine, LoyaltySettingsSection, OfficeCardFrame.
- Branches (5): AccountingRecordSection, AccountingSectionHead, FormDrawer, OfficeRoomResources, SalesRow.
- Composites (23): AgentAutomationsFrame, AgentChatThread, AgentSetupBand, AuthForm, AuthFrame, AuthoritySection, AuthPanel, AutomationCard, AutomationDetailFrame, BookingSetupSection, ContentSettingsCard, FirstRunCard, FirstRunStep, HiringPublicShell, HiringReplyCard, KnowledgeRows, LeadPanel, LoyaltyEarningRules, LoyaltyTierRules, OfficeThreadScroll, TeamSection, WizardFrame, WorkspacesFrame.
- Blocks (15): AgentDashboardFrame, AgentInstanceFrame, AgentProfileHead, AuthorityHead, AutomationsHeading, BrainPageFrame, ConnectionsFrame, ConsoleSessionGate, ContentWorkbenchGate, DevelopersPanel, LeadPageHead, SalesWorkbenchGate, TeamPageFrame, VideoLibraryGate, VideoStepGate.
- Duplicates of grammar jobs by local wrappers: `FiguresStrip` and `FiguresRibbon` are identical; `FormActions` hand-rolls a button row; `ConnectionCopyInput` and `CopyTextButton` do `CopyField`'s job.
