# The fragment format

A lane writes one fragment, `pages/<NN>-<slug>.html` under `.starcistacks/canvas/` (the folder, the screen ids, the
states and the sizes are PROJECT-GALLERY-6's). The board classes are those of [kit/canvas.css](../kit/canvas.css); the
colours and Grammar roles are the `var(--…)` tokens and classes of the app's `tokens.css`.

## A screen is one section

Each screen of the page, its base screen first and then each state the page has in the order of the state table, is one
section:

```html
<section class="page" id="customers-list-empty" data-pid="customers/list-empty" data-route="/customers" data-title="Khách hàng, trống">
  <h2>Khách hàng, trống</h2>
  <div class="pid">gallery: customers/list-empty</div>
  <div class="status">Bản vẽ, chờ duyệt</div>
  <div class="row">
    <div class="frame"><div class="lbl">Khách hàng, trống · 1440</div><div class="scr w1440 zoom">…the full screen with the app shell…</div></div>
    <div class="frame"><div class="lbl">Khách hàng, trống · 390</div><div class="scr w390">…</div></div>
    <div class="note">…the screen's explain.md…</div>
  </div>
</section>
```

- `id` is the screen id with `/` written `-`; `data-pid` is the gallery id itself; `data-route` the route of the screen.
- The label is `<Trang>, <trạng thái> · 1440` or `· 390` (the base screen's state is `danh sách`, or the page's own word for
  its resting state). A frame is drawn at real pixels: `.w1440` or `.w390`, and `.zoom` shows a 1440 frame at 50%.
- The status chip reads the screen's status in `design.json`: `Bản vẽ, chờ duyệt` (drafted), `Đã duyệt` (approved),
  `Đã code` (built), `Khớp gallery` (matches).
- Inside a frame: the app shell (sidebar or top bar on 1440; top bar and bottom bar or drawer opener on 390, really
  reflowed, never shrunk) and the screen in its state. A Grammar element the screen lacks carries a small
  `cần Grammar` tag where it is drawn.
- A fragment may hold one `<style>` whose every selector starts with its sections' ids (`section[id^="customers-"]`) or
  a lane class; it uses the `var(--…)` tokens and writes no new hex colour. No `<script>`, no external image.

## The note is the explain.md

The note holds exactly the screen's `explain.md` (PROJECT-GALLERY-2 item 1), so the code lane copies it line for line:

```html
<div class="note">
  <div class="fm">title: Khách hàng, trống · route: /customers · area: customers</div>
  <p class="intro"><b>Concept: Khách hàng.</b> Mục tiêu: … Thao tác: <code>contacts(search, limit)</code>, <code>createObject</code>;
    cần API: <code>importContacts</code>. Bố cục: … Nút chính: … Lọc: … Khác bản hiện tại: … Lưu ý xung đột: …</p>
  <h4>Trạng thái trống</h4>
  <p>Vì sao: …</p>
  <p>Luật: …</p>
  <p>Grammar: <code>EmptyState</code> kind <code>first-record</code>, slot <code>action</code></p>
</div>
```

| note | explain.md |
|---|---|
| `.fm` (`title · route · area`) | the front matter `title`, `route`, `area` |
| `.intro` | the introduction, the text before the first `## ` |
| each `<h4>` | one `## <region name>` |
| the `<p>` lines under it | its `Vì sao:`, `Luật:` and `Grammar:` lines |

The introduction is one dense paragraph, its clauses in this order:

- **Mục tiêu:** the business job of the page, in the owner's words.
- **Thao tác:** the real operations the screen calls, by their names in the code, and each missing one as
  `cần API: <operation>`.
- **Bố cục:** the list and detail split and why.
- **Nút chính:** the single primary action.
- **Lọc:** how search, filters and sort work.
- **Khác bản hiện tại:** the jobs that change against today's app: a job added, merged, moved to another page or
  dropped. Never a comparison of layouts.
- **Lưu ý xung đột:** where two sources disagree, which one the drawing follows, naming each source.

Every visible region of the screen has its `<h4>` and three lines; a state screen explains all its regions, not only
the one its state changes. The `Grammar:` line names the element, its kind and slot, and a missing element as
`cần Grammar: <what>`.
