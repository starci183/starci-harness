# Identity mark: Avatar and IconTile

Contract: [Avatar and IconTile](../../grammars/contract.md#avatar). Vendor: [Avatar](../../vendor/heroui.md#avatar).

## Job
A compact anchor that helps the reader scan peers, always beside the visible name it belongs to.

## Choose

Choice `identity-mark.choose.role`: which mark anchors the name (an avatar or initials for a user, a logo stack, an icon tile).

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| outcome | the mark would report an outcome | a toned `Badge` (`chip.choose.role:state`), not a tile (ACCENT-5) | judgement |
| group | a group or conversation, a row of providers or channels, any avatars side by side or from a list | `AvatarGroup items max`: people (`name`, `seed`) and marks (`mark`) in one round group (COLLECTION-3); never two `Avatar` siblings or a mapped `Avatar` | `DNA-COMMON-AVATAR-GROUP-ONE-SIZE`, `DNA-COMMON-AVATAR-ROW-GROUP` (lint `starci-grammar/avatar-row-uses-group`) |
| connections | the provider connections an agent or a workspace uses | an `AvatarGroup` of `kind: "logo"` items at the row's `size` (`sm` 24 beside text, `md` 40), max 3 then "+N" as the vendor draws it; a lone logo is an `Avatar kind="logo"` of the same `size`, never a bare image; an app's own content as a menu trigger is the exported `PlainPressable` | judgement |
| person | a person or an agent | `Avatar`: uploaded image, else two initials on a name-coloured plate; the avatar of an agent is initials like the rest; its "AI" Chip follows the NAME (`isAgent` on the name slot) | `DNA-COMMON-AVATAR-INITIALS`, `DNA-COMMON-AGENT-NAMED`, `DNA-COMMON-AGENT-NAME-CHIP` |
| floating | the reader's own identity as a floating entry point (an account or assistant launcher over the page) | `AvatarButton size="floating"` (56px, overlay shadow) with `status={{ tone, label }}`: a StatusDot at the top end on a surface ring, its `label` the button's accessible description | story `Navigation & Data/Spotlight/AvatarButtonFloating` |
| kind | a feature, product area or entity kind | `IconTile` with a reviewed semantic glyph | candidate: an `IconTile` is painted neutral |

## Status marks: (A) inline and (B) the round 40px tile 

One style for every status in every situation:

- **(A) Inline status** — `InlineStatus state label meta?`: a bare outline glyph at the icon size of the text beside it, 24px beside its own 14px words and 20px inside a 12px line (a caption, a Badge), derived from the text and never a prop ([situations](../situations.md) "Icon and mark sizes") (circle-check, spinner, circle-pause, circle-x, circle-minus, circle-dashed) and its words, both in the state's ink (`text-<tone>`), with NO plate. For a status word in a row or a cell, a legend, a graph edge label, a Badge with an icon, and the status that trails a (B) tile: glyph, then words, then time.
- **(B) Standalone status mark** — `IconTile state` (and the markers of `Timeline`, `Stepper`, the setup checklist and the all-clear; never an `Alert`, whose mark is the bare 24px Heroicon in its soft foreground on its soft box, [toast-alert](toast-alert.md)): the ROUND tile on the `<tone>-soft` plate at **40px only** (there is no 32px status mark). The PLATE TONE is the state: success done, SUCCESS running (running is green everywhere; done and running are told apart by the glyph, the check against a spinner or a spinning ring around a subject; accent stays the brand for selection, links and the primary action; `info` stays a built-in tone for other uses), warning waiting, danger error, neutral skipped or not run.

**Three status glyphs.** circle-check is done; circle-x is error, stopped, cancelled or overdue; the plain circle is waiting (warning), skipped and not run (muted): the colour tells them apart. Running is the same circle as a spinning ring (still under reduced motion). No pause, clock, minus, dashed or info glyph is a status, in InlineStatus, Badge or Chip icons, a legend or a graph. Inside the round 40px tile (B) the glyph is the BARE equivalent, so no circle sits in a circle: check, x, a small ring (spinning while running) (`STATUS_GLYPH.tile` and `STATUS_GLYPH.inline`). Sizes: inline (InlineStatus, beside or inside a line) the glyph is text-sized, 1em of its words; in the 40px tile 20, in an empty state's 48 tile 24. No bare ✓ or ✗ as an inline mark.

**Standard tokens only**: a status tile's plate is the tone's `--<tone>-soft`; an Alert's box is the tone's `--<tone>-soft` with its glyph and copy `--<tone>-soft-foreground`; a card face that waits on the reader draws its edge in `--<tone>-border` (`SurfaceCard tone`, `MessageBubble content="card" tone`, one rule: `toneEdge.ts`). Grammar defines the border step for every tone with one derivation (`common/tones-border.css`); no component mixes its own colour.

**A running state is ONE tone**: the plate, the glyph, the spinner, the ring and the trailing word are all `success` green; no accent, blue or purple mixed in. An app never maps running to `info`, `accent` or a blue of its own: it passes the state and Grammar picks the tone.

What the (B) tile carries depends on the reader's question:

| The reader asks | Situation | The tile carries | What trails |
| --- | --- | --- | --- |
| "How far along is it?" | the steps of ONE thing: Timeline and Stepper markers, a run's step list, a setup checklist, the all-clear | the STATUS glyph, one of three: circle-check done, circle-x error, the plain circle waiting, skipped or not run, spinning while running (`IconTile state` with no `source` carries their bare check, x and small ring) | the step's name is the subject; time or meta trails, never a status word |
| "Which thing is which?" | DIFFERENT things side by side: a run or workflow list, notification rows, chat run cards, graph nodes | the SUBJECT icon the app passes in (the workflow, step or channel icon) on the state's plate (`IconTile source state`, a row's `leading: { icon, state }`) | the status as (A): a small glyph and a word, then the time |

- A check inside the tile appears only when the mark has no subject of its own (the all-clear, a done step), and it is the bare check.
- A person's own current step (a Stepper, a setup checklist) is its number on the running tile (success): it is in progress, nothing spins.
- **Never A and B as two large circles side by side.** The pattern: B leads the row, A and the word trail it.
- A graph node (`@starci/grammar/core/ext/graph`) follows (B): its kind icon on the state's plate, the status chip as (A); its status border stays.
- The **hand-composed** lens ([../../project/gallery.md](../../project/gallery.md) PROJECT-GALLERY-8) flags a hand-drawn status circle.

## (C) The subject tile of a workflow

A workflow (and a run or thread of it) wears ONE tile wherever it stands (owner 2026-11-27, "logo workflow phải đồng nhất"): its page head (`size="head"`),
its run's page head, and every list row that names it (`leading: { icon, activity }`). It is `IconTile source activity`: the workflow's OWN icon on the
square identity plate, toned by what it is doing, never by the app: `idle` (also done) the accent's soft pair, the brand; `running` the warning's soft
pair, amber; `error` (failed, stopped, needs a person) the danger SOLID, the white glyph on the full danger plate, so a stop never reads as the brand's
red. The status still trails as (A). This supersedes, for a workflow's own mark only, the round (B) "which thing is which?" tile and its green running;
a step, a graph node and a Timeline keep (B).
- Laws: `DNA-COMMON-ICON-TILE-ROUND`, `DNA-COMMON-STATUS-MARK-40`, `DNA-COMMON-INLINE-STATUS-NO-PLATE`, `DNA-COMMON-TIMELINE-STATUS-TILE`. Story `Status marks`.

## Variants
Tiles are neutral; a tile takes a status tone only when it reports a real outcome, never accent for identity
(ACCENT-2). The mark never replaces the name.

**A palette the app owns goes in by slot.** Which colour a team, a room or an agent wears is the
app's business, so the Grammar owns no such palette: an `Avatar`, an `AvatarGroup` item and an `IconTile` take `tone={{ soft, ink }}` (a
`ToneSlot`: two CSS colours or `var()` refs of the app's own light and dark tokens), the plate and the letters or glyph on it, the same way the
Grammar takes an app's icons. The app keeps its palette, the helper that picks a pair from a stable key, and the 4.5:1 contrast of each pair in
its own tests. A status or an outcome never rides a slot; it takes its named tone.

## Plates of an initials mark
An `Avatar` with no image draws a generated mark (default) or the name's initials on a plate: `tone="accent"` (the accent soft pair), `tone="solid"` (the solid accent plate, `--accent` with `--accent-foreground`: the brand mark) and `tone="strong"` (the neutral strong plate, `--foreground` with
`--background`: the signed-in person among the others). `AvatarButton` forwards `tone` to its avatar (an avatar with no image always draws its initials), so the account control of a bar is a strong lettered circle. `IdentityLockup markTone="solid"` draws the brand mark as the solid plate beside the name
(`accent` stays the soft one). A tone is a fact of the mark (whose it is), never a decoration: one solid plate per screen, the brand's.
Story `Navigation/Shell gaps (0.46.0)` `AvatarPlates`.

**The workspace switcher** (a lettered tile, the name and a caret, `:12`, `:216`) is composed, not a Button feature: `DropdownMenu` or `Popover` with an `IdentityLockup` (a lettered mark, the name, a muted line) as its `trigger`, in the bar's `brand` slot. `Button` is not extended: its start slot is the primary's alone and a switcher is not a command.
A caret on the lockup is not provided (the lockup is drawn with no caret or button chrome); an app that wants one asks for it.

## Size
A round mark takes `size="sm" | "md"` only, on the ramp [../scale.md](../scale.md) owns (`md` 40, the common size; `sm` 24, the icon size). `AvatarButton size="floating"` (56px) is the launcher, not a mark. An IconTile is the row tile (40, radius 10, a 20 glyph) leading a list row, or the head tile (48, radius 12, a 24 glyph, `size="head"`) beside a page title or in an empty state; a status mark (`state`) stays the round 40, its running ring spinning on the plate's edge ([../scale.md](../scale.md) "The icon table").

## States
Skeleton keeps the mark's footprint.

## Owner split
- **Grammar owns:** initials, the colour a name gets (a stable palette of its tone tokens chosen by seed), group tiles and rows, marks, the AI Chip after a name, shapes and sizes.
- **Knowledge decides:** avatar vs tile vs badge; tile tone; step by copy.
- **App author decides:** the identity data (name, id, image) and the glyph's meaning.

## Initials, marks and the AI Chip
An avatar with no image draws DiceBear's **Initials** style: one or two letters centred on a solid coloured background, deterministic from the seed, for a person, an agent, a product or a shop alike. It is generated locally with `@dicebear/core` and the pinned `@dicebear/styles` Initials style (CC0): no network, never api.dicebear.com, no name sent to a third party. An uploaded image overrides it. The round crop and the size ramp are the Avatar's.

- **The initials rule:** the first letter of the first word plus the first letter of the last word, uppercased, diacritics kept. A Vietnamese name is family name first and given name last, so `Nguyễn Văn An` is `NA`, `Đỗ Thị Hoa` is `ĐH`, `Lê Quang Đạt` is `LĐ`; the middle words never count. One word gives its first two letters (`Nivo` is `NI`); nothing readable is `?`. Composed and decomposed Unicode give the same letters.
- **The colour:** seed it from a stable id (the member id or agent key), so the colour stays put when a name changes; the letters come from the display name. A hash of the seed picks one of eight Grammar theme tones (light accent, success, warning, danger; dark success, warning, danger; foreground) passed as the style's `backgroundColor` list, and the style draws white or black letters with 4.5:1 on every entry. An app never picks it.
- **The AI Chip:** the AI pill is off the avatar; an agent's avatar is initials only and `kind="agent"` only names it `Name (AI)` for assistive technology. The "AI" is a small neutral Chip right AFTER the name: `AgentName` (the name, then Grammar's Badge, default tone, no icon, at the CAPTION size: 12/16 in a 16px box with a 4px inset, on the name's baseline, never the 24px pill (`DNA-COMMON-AGENT-NAME-CHIP-CAPTION`); the word is `agentLabel`, default `AI`). It is placed by the slot, through `isAgent`: `ListRow` (the row's title), the card head (`CardHead.isAgent`), `MessageBubble` (the sender line) and the members list (`ListBox` item). An app never places the Chip by hand.
- **Marks:** a provider or channel is its real brand LOGO on a round plate: `Avatar mark={{ logo?, color?, ink?, tone? }}`. The app passes its own logo set through `logo` (a node or an icon source); Grammar ships no brand logos. A provider never shows initials ("ZA", "FA", "TI"): with no `logo` the mark draws the generic channel glyph. The danger ring marks a broken account. The plate is a Grammar token (`--accent` by default; `tone` `accent` or `strong`), or a brand colour the app passes in as `color` with `ink` for the icon on it (brand colours are content, like `ColorSwatch`'s). The name still names it.
- **The group:** `AvatarGroup items max` takes people and marks together, round, in one overlap and one "+N" pattern. `layout="row"` (default) overlaps them in a line (providers beside a name); `layout="grid"` is the Zalo-style identity (`DNA-COMMON-AVATAR-CLUSTER`, owner 2026-11-26: "nhóm k cần hình tròn"): NOT one big circle cut into tiles, but the square of one avatar holding small ROUND member avatars set close in a 2 by 2 cluster, never clipped by an outer circle. One member is the whole square; two stand on the diagonal (the first top start, the second bottom end); three are two over one (the third centred under the pair); four or more are three members and, bottom end, a count cell (the muted pair) that reads the number of members of the whole group (4, 5, 29; no plus). Each cell shows that member's initials, image or mark. `photo` (a group's own picture) replaces the cluster with one round Avatar of the same size, named by `label`; a group with no member shows the initials of `label`. `max` is the number of slots of the `row`, "+N" included (default 4): up to `max - 1` items show and the last slot reads `+N` for the rest (five items: three and "+2"); seven providers in a row with `max={6}` show five and "+2". The cluster ignores `max`: it never holds more than three members and the count. `overflowLabel` still receives the members not drawn.
- **Round at every size:** a circle Avatar is a square box (its size on both axes, an aspect ratio of 1, never squeezed by a flex row or stretched by a slot) clipped by a 50% radius, at `md`, at `sm` and wherever a size variable lands (`DNA-COMMON-AVATAR-ROUND`).
- **A customer's channel:** `Avatar channel="messenger"` (also `instagram`, `facebook`, `zalo`, `whatsapp`, `telegram`, `tiktok`, `gmail`, `line`, `viber`, `wechat`, `x`, `youtube`, `discord`, `googlechat`, and Grammar's own `email`) puts a small round logo badge on the avatar's bottom end corner (`DNA-COMMON-AVATAR-CHANNEL-BADGE`): a third of the avatar at 40 and half of it at 24, on the white logo plate, ringed in the surface so it reads over a photo and over initials alike, OUTSIDE the avatar's clip. The logos are simple-icons paths vendored in `CHANNEL_LOGOS` (CC0), in the brand colours of `--grammar-channel-*` (TikTok and X take the logo ink). The badge is named by `channelLabel` (the brand's name when omitted), so the person and the channel are one image for assistive technology. The badge never replaces the person's own image or initials. Story `Navigation & Data/Chat avatars`.
- **A broken account:** an item with `tone="danger"` is ringed in the danger token (an outline in its own box, no wider hit area).
- **The group shows alone:** no member names printed beside it; `max` slots, then "+N". The "+N" mark is always the neutral muted pair (the default plate, the muted ink), never a generated or accent colour, at 24 and at 40.
- **The member list:** hover, keyboard focus or a tap on the group opens a non-modal list of EVERY member, the hidden ones too: each row its 24px avatar, its name and, for an agent, the small "AI" Chip (`AgentName`, the word `agentLabel`). It takes no focus; the pointer leaving, Escape, a blur or a press outside closes it. Inside a whole-card link (`EntitySummaryCard`) the group passes `hasMemberList={false}`: a link holds no control of its own.
- **The words:** the group is named by the app's own `label` (also the list's name) or `describe` ("A, B và 3 người khác"). Grammar writes no sentence.
- **An agent's display name** should not contain "AI" ("Trợ lý bán hàng", not "Sales AI"): the Chip after it already says so. Documentation only; nothing checks it.
- **The lint:** two `Avatar` siblings, or an `Avatar` returned from `.map()`, outside an `AvatarGroup` is an error, `starci-grammar/avatar-row-uses-group` (`DNA-COMMON-AVATAR-ROW-GROUP`).

## Rules
ACCENT-2, COLLECTION-3, FE-APP-SHELL-3. Proof: TASTE-5, A11Y-2.
