import type { MessageBundle } from "@modules/platform/i18n"

/** Display text of the queue codes, Vietnamese and English. */
export const QUEUE_MESSAGES: MessageBundle = {
    vi: {
        "errors.QUEUE_NOT_PERSISTED":
            "Redis chưa ghi các tác vụ vào tệp append-only kịp thời; các dòng outbox vẫn chờ gửi lại.",
        "errors.QUEUE_JOB_LOST":
            "Redis không còn giữ một tác vụ vừa thêm vì đã khởi động lại; dòng outbox của nó sẽ được gửi lại.",
        "errors.QUEUE_MALFORMED_MESSAGE": "Thông điệp hàng đợi đã lưu không hợp lệ.",
        "errors.QUEUE_CORRELATION_INVALID": "Mã tương quan của thông điệp hàng đợi không hợp lệ.",
    },
    en: {
        "errors.QUEUE_NOT_PERSISTED":
            "Redis did not write the queued jobs to its append-only file in time; their outbox rows stay waiting.",
        "errors.QUEUE_JOB_LOST":
            "Redis no longer holds a job it was handed because it restarted; its outbox row is relayed again.",
        "errors.QUEUE_MALFORMED_MESSAGE": "The stored queue message is malformed.",
        "errors.QUEUE_CORRELATION_INVALID": "The queue message correlation id is invalid.",
    },
}
