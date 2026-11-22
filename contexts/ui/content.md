# Content: business first

What a screen SAYS, before how it looks. The owner's rulings of 2026-11-22: "không render ngôn ngữ kĩ thuật trừ tính chất dự án" (render no
technical language unless the project's nature calls for it), and "k muốn render kĩ thuật là nói concepts để fe sửa thôi": this is a
CONCEPT the front end writes to, not a word list, a translation map or a check. Adopted into the harness on "ok h update .claude lại"; a
screen is approved by its look on "screen phải duyệt kĩ" ([../project/gallery.md](../project/gallery.md) PROJECT-GALLERY-10).

## CONTENT-1 The reader sees business concepts, never system internals

What an owner reads is the business: **what happened**, **to whom** (which customer, which staff, which channel) and **what to do next**.
What the system did to get there (its runs, workflows, triggers, providers, codes, ids, steps) is an internal, and an internal never reaches
a business reader's summary. It may sit in a detail tab of the thing it describes, behind the summary, for the reader who asks.

Every `screen.yaml` states the 2 or 3 questions its screen answers, as `questions` ([../project/gallery.md](../project/gallery.md)
PROJECT-GALLERY-8). An agent's summary is the Grammar's `EntitySummaryCard`: its `role` sentence and its three weekly business figures
("Every agent shows 3 weekly business figures"; owner: "agent nào cũng có 3 chỉ số tuần này… enforce interface"), results the owner reads,
never run or workflow counts.

## CONTENT-2 The app declares its audience

Each front-end app says who reads it, `audience` in `hfs.json` (`sides.fe.apps[]`): `business` (a shop owner and their staff: NIVO) or
`technical` (a developer or an operator: StarCi Next). It is the concept the content is written to and the audit judges against; no check
reads the copy.

- **business**: business concepts only (CONTENT-1, CONTENT-3).
- **technical**: technical terms are allowed, each finding led by the human sentence ("The deploy waited for the database and gave up after
  60 s"), the code after it.

## CONTENT-3 Wrong versus right, situation by situation

Write the right column the first time. When the reader needs the raw fact (to send to support), it goes in a collapsed **"Chi tiết kỹ thuật"**
(a `Disclosure`, closed) under the business sentence, never instead of it.

| Situation | Wrong (system internals) | Right (the business concept) |
| --- | --- | --- |
| A run card in the chat | "Run #48213 · workflow `quote.send` · trigger message.received · 3/5 steps" | "Báo giá cho chị Hoa: chờ bạn duyệt" with the subject icon, the status as words, and "Duyệt và gửi" |
| An error | "do_not_contact" · "Webhook failed: 401" · "Provider key invalid" | "Khách đã yêu cầu không liên hệ, nên trợ lý không gửi tin." · "Không nhận được tin nhắn mới từ Facebook. Hãy kết nối lại trang." · "Kết nối Zalo đã hết hạn. Kết nối lại để trợ lý tiếp tục trả lời." |
| A waiting state | "Pending: node `approve_price` awaiting human input" | "Chờ bạn duyệt giá cho chị Hoa (từ 09:14)" and the one action |
| A summary card | "12 luồng · 248 lượt chạy · trigger: message.received · ● Khoẻ · [Mở agent]" | "Sales AI · Đang làm việc"; "Trả lời khách hỏi giá và chốt đơn"; Tuần này: 42 đơn chốt, 18,4tr doanh thu, 3 khách phàn nàn; "3 báo giá chờ bạn duyệt"; the whole card opens the agent |
| A notification | "Cell `crm.lead.create` succeeded (payload 2.1 KB)" | "Có khách mới: anh Minh để lại số điện thoại trên Facebook" |
| A settings page | "Provider: zalo_oa · Kind: webhook · Token: Bearer eyJ…" | "Zalo của cửa hàng: đã kết nối (Hoa Mộc Spa)" with "Kết nối lại" and "Ngắt kết nối"; the account's details in "Chi tiết kỹ thuật" |

**No typed arrows** ("Không dùng ký tự mũi tên gõ tay; hướng đi là icon của Grammar"): a direction or a change ("from → to", "Bước 1 → Bước 2",
"Xem thêm →") is never an arrow character in the copy; it is the Grammar's arrow icon, `Link`'s arrow or `Button endArrow` (lint
`starci-grammar/no-typed-arrow`, [components/button.md](components/button.md)).

An internal id never names a thing on screen (a uuid, a PSID, a file key, a numeric run id as a title): the thing's own business name does.
English engine text never reaches a business reader; the app writes its own Vietnamese sentence for each situation.

## How it is held

- The UI audit's content lenses **business**, **hand-composed** and **tech-leak** ([../project/gallery.md](../project/gallery.md)
  PROJECT-GALLERY-8 item 3): the auditor's judgement against this concept, with no word list.
- The lane brief names the screen's questions before code (PROJECT-GALLERY-10).
- The Grammar contract laws `DNA-COMMON-CONTENT-BUSINESS-FIRST`, `DNA-COMMON-ENTITY-SUMMARY-THREE-FIGURES` and
  `DNA-COMMON-SCREEN-OWNER-REVIEWED` ([../grammars/contract.yaml](../grammars/contract.yaml)).
