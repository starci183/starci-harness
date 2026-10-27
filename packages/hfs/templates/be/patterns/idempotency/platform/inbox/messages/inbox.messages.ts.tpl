import type { MessageBundle } from "@modules/platform/i18n"

/** Display text of the inbox codes. */
export const INBOX_MESSAGES: MessageBundle = {
    vi: {
        "errors.INBOX_OUTCOME_INVALID": "Kết quả thao tác không phải dữ liệu JSON thuần nên không thể lưu.",
        "errors.INBOX_OUTCOME_MISSING": "Không lưu được kết quả thao tác.",
        "errors.INBOX_TRANSACTION_REQUIRED": "Thao tác này cần một giao dịch đang hoạt động.",
    },
    en: {
        "errors.INBOX_OUTCOME_INVALID": "The operation outcome is not plain JSON data, so it cannot be stored.",
        "errors.INBOX_OUTCOME_MISSING": "The operation outcome could not be recorded.",
        "errors.INBOX_TRANSACTION_REQUIRED": "This operation requires an active transaction.",
    },
}
