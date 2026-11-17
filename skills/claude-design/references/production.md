# Producing the canvas: one lead, ten lanes

Everything is written in the app's `.starcistacks/canvas/` (its layout, the screen ids and the lifecycle are
PROJECT-GALLERY-6's) and committed on the lane's branch.

## The kit (the lead)

- `canvas.css`: copied unchanged from [kit/canvas.css](../kit/canvas.css), the board, frame, label, status and note classes.
- `tokens.css`: the app's Grammar look (the brand token names are the ones `.starcistacks/brand/brand.md` lists, [PROJECT-BRAND-3](../../../contexts/project/brand.md#project-brand-3-a-design-or-image-brief-reads-the-brand-folder-first)). Custom properties taken from the app's brand.css and the Grammar's theme hooks
  (`--bg`, `--fg`, `--fg2`, `--muted`, `--faint`, `--border`, `--sep`, `--hover`, `--fill`, `--selected`, `--accent`,
  `--accent-soft`, `--accent-text`, the `--ok`, `--warn`, `--err` and `--info` pairs, `--r`, `--r-card`, `--shadow-pop`), and one
  class per Grammar role a lane draws, named after the role in `contexts/ui/components/` (`.btn.primary`, `.btn.secondary`,
  `.input`, `.card`, `.badge` with `.b-ok`, `.b-warn`, `.b-err`, `.b-info`, `.b-neutral`, `table.t`, `.nav-item`, `.ribbon`,
  `.pop`...), so a lane draws roles, never styles.

## A brief (the lead, `briefs/<NN>-<slug>.md`)

```
# <Trang>  (gallery: <area>/<screen>, route <route>)
Mục tiêu: <the business job, in the owner's words>
Thao tác: <each backend operation by its name in the code, what it reads or writes; each missing one as cần API: <operation>>
Dữ liệu: <the fields, and 5 to 8 rows of real Vietnamese sample data>
Trạng thái: <the states of the record and which screen states of PROJECT-GALLERY-6 apply; those left out and why>
Quyền: <who may see and do what; the approvals a step needs>
Grammar: <the elements, kinds and slots to draw with; each missing one as cần Grammar: <what>>
Hành động chính: <one>
Lọc: <search, filters, sort>
Việc đổi: <the jobs added, merged, moved or dropped against today's app>
Xung đột: <source A says, source B says, follow which and why>
```

## The lane prompt (Sonnet, one page each)

"You draw the page of `.starcistacks/canvas/briefs/<NN>-<slug>.md` in the app <repo>, following
`<harness>/skills/claude-design/SKILL.md` (its Method and its look) and `references/format.md`. Read the brief, the
operations it names in `be/`, `tokens.css` and `canvas.css`. Write only `.starcistacks/canvas/pages/<NN>-<slug>.html`:
one section per screen (the base screen, then each state of the brief), each with its 1440 and 390 frames and its note,
which is the screen's explain.md. Draw the right UX: a missing Grammar element is `cần Grammar`, a missing operation is
`cần API`, neither is a question. Preview with `node <harness>/skills/claude-design/kit/build.mjs <app> "<Title>"` from
`.starcistacks/canvas/` (other lanes' fragments may be present), open the board in the built-in browser, read your
frames at full size and fix what looks off. Report your screen ids, the operations each uses, every `cần Grammar` and
`cần API` item, and any business question for the owner. No commit, no npm install, no python, no other lane's files."

## The assembler

[kit/build.mjs](../kit/build.mjs), run from `.starcistacks/canvas/`, joins `tokens.css`, `canvas.css` and the fragments
in `NN` order into `<app>-design.html` with an index of the screens, and refuses a fragment with a `<script>` or a section
without `id`, `data-pid` and `data-title`.

## The lead's review

At full size, every section: a gallery id that follows the state names, both widths, the label format, one primary per
frame, no card used as a section frame, badges with meaning, the 390 frames really reflowed, and a note that is a whole
explain.md (front matter line, the intro's clauses in order, every region with its three lines). Fix by editing the
fragment or the kit, rebuild, set each drawn screen `drafted` in `design.json`, publish `<app>-design.html` as an
Artifact (the same path again for a later round, so the link stays) and record the link as `board`.

## The lifecycle steps

Each status is set by the role PROJECT-GALLERY-6 item 5 names, and only then:

- **Approved (the lead).** On the owner's "đẹp" for a page in chat: every screen of that page gets `status: approved`,
  `approvedAt` (now, a full ISO timestamp with the zone such as 2026-11-17T09:30:00+07:00, never a bare date) and no `shots`; the area goes into `areas` once all its screens are approved.
- **Built (the code lane).** Code the page with its `cần API` operations; shoot `gallery/pages/<area>/<screen>/` at 1440
  and 390; write its `explain.md` from the note by the table of [format.md](format.md#the-note-is-the-explainmd); set
  `status: built` and record the shots:
  ```
  node -e "const c=require('crypto'),f=require('fs');for(const w of ['1440','390'])console.log(w,c.createHash('sha256').update(f.readFileSync('gallery/pages/<area>/<screen>/'+w+'.png')).digest('hex'))"
  ```
- **Matches (the lead or a reviewer, not the code lane).** Open the shots beside the approved frames at full size; when
  they match, set `status: matches` and record the sha of the shots compared. A shot that differs goes back to the code
  lane; a design that must change is redrawn and returns to `drafted`.

A UI change to a page that is already built enters this flow at step 1: its page is redrawn or adjusted (back to `drafted`, `approvedAt` and `shots` dropped), approved again, then coded and shot. PROJECT-GALLERY-7 owns the order; `HFS_APP_GALLERY_DESIGN_CHANGE_UNAPPROVED` flags code that skipped it.

`starci app check` then judges the manifest against the gallery (the `HFS_APP_GALLERY_DESIGN_*` codes of
PROJECT-GALLERY-6).
