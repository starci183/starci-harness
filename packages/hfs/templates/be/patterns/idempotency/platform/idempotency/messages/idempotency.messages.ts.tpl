import type { MessageBundle } from "@modules/platform/i18n"

/** Display text of the public client-operation refusals. */
export const IDEMPOTENCY_MESSAGES: MessageBundle = {
    vi: {
        "errors.IDEMPOTENCY_KEY_REUSED": "Khóa thao tác đã được dùng cho nội dung khác.",
        "errors.IDEMPOTENCY_REQUEST_INVALID": "Khóa, phạm vi hoặc dữ liệu thao tác không hợp lệ.",
    },
    en: {
        "errors.IDEMPOTENCY_KEY_REUSED": "This operation key was already used with a different request.",
        "errors.IDEMPOTENCY_REQUEST_INVALID": "The operation key, scope or JSON data is invalid.",
    },
}
