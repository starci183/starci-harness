# The board format

## Canvas

- Background: a neutral grey (`#ececec` in kit.css as `--board-ground`), the page body scrolls both ways.
- Rows: one per page, in the app's navigation order; a 160px gap between rows, 64px between frames of a row.
- Each row starts with the page's concept note, then the frames: for each state in the order of the state list,
  the 1440 frame, then its 390 frame.

## Frame

- A frame is a fixed box of the width it is labelled with (1440 or 390) and the height of its content (at least
  900 for 1440 and 844 for 390), clipped, with the app's page ground (white on a white theme) and a soft
  shadow so it stands on the grey.
- It holds one screen: the app shell (sidebar or top bar on 1440, top bar and bottom bar or drawer opener on 390)
  and the page in that state, with real Vietnamese sample data (names, amounts in đ, dates as dd/mm/yyyy).
- The label sits 12px above the frame, 14px medium, muted: `Khách hàng, danh sách · 1440`.

## States

| state | what the frame shows |
|---|---|
| danh sách | the list with real rows, the primary action, filters at rest |
| chi tiết | one record open (detail pane on 1440, its own screen on 390) |
| trống | no record yet, the empty state with the one action that creates the first |
| lần đầu | the first visit: onboarding hint or setup step, when the page has one |
| đang tải | the skeleton of the ready layout, same boxes, nothing else |
| lỗi | the load failed: the error with retry, the shell intact |
| không khớp bộ lọc | filters set, no match: the empty state that clears the filters |
| đang soạn | the create or edit form open, with a validation message on one field |

## Concept note

A yellow note (`--board-note: #fff3b0`), 360px wide, 14px text, its title `Concept: <Trang>` bold. One
paragraph, the clauses in this order and labelled inline:

> **Concept: Khách hàng.** **Mục tiêu:** chủ shop tìm lại một khách trong 5 giây để xem nợ và nhắn tiếp.
> **Bố cục:** danh sách bên trái, chi tiết bên phải trên 1440; trên 390 chi tiết là màn riêng. **Hành động chính:**
> "Thêm khách" (một nút đỏ duy nhất). **Lọc:** ô tìm theo tên hoặc số điện thoại, chip "Còn nợ" và "Mới tuần
> này", không có bộ lọc nâng cao. **Khác bản hiện tại:** bỏ bảng 9 cột, cột nợ thành badge; chi tiết không còn
> là dialog. **Lưu ý xung đột:** brief nói xoá khách được, concept `customers` nói chỉ lưu trữ: theo concept.
