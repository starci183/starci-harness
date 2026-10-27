import type { MessageBundle } from "@modules/platform/i18n"

/** Display text of queue failures in Vietnamese and English. */
export const QUEUE_MESSAGES: MessageBundle = {
    vi: {
        "errors.QUEUE_MALFORMED_MESSAGE": "Th\u00f4ng \u0111i\u1ec7p h\u00e0ng \u0111\u1ee3i \u0111\u00e3 l\u01b0u kh\u00f4ng h\u1ee3p l\u1ec7.",
        "errors.QUEUE_CORRELATION_INVALID": "M\u00e3 t\u01b0\u01a1ng quan c\u1ee7a th\u00f4ng \u0111i\u1ec7p h\u00e0ng \u0111\u1ee3i kh\u00f4ng h\u1ee3p l\u1ec7.",
    },
    en: {
        "errors.QUEUE_MALFORMED_MESSAGE": "The stored queue message is malformed.",
        "errors.QUEUE_CORRELATION_INVALID": "The queue message correlation id is invalid.",
    },
}
