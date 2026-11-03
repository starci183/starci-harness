import type { MessageBundle } from "@modules/platform/i18n"

/** Display text of the identity codes, Vietnamese and English. */
export const IDENTITY_MESSAGES: MessageBundle = {
    vi: {
        "errors.IDENTITY_UNAUTHENTICATED":
            "Bạn cần đăng nhập để thực hiện thao tác này.",
        "errors.IDENTITY_REFRESH_INVALID": "Phiên đăng nhập không hợp lệ hoặc đã hết hạn.",
        "errors.IDENTITY_REFRESH_REUSED": "Phiên đăng nhập đã kết thúc vì bị dùng lại. Hãy đăng nhập lại.",
        "errors.IDENTITY_ACCOUNT_DISABLED": "Tài khoản này đã bị khóa.",
        "errors.IDENTITY_TOO_MANY_ATTEMPTS": "Quá nhiều lần thử. Hãy thử lại sau.",
        "errors.IDENTITY_INVALID_CREDENTIALS": "Email hoặc mật khẩu không đúng.",
        "errors.IDENTITY_EMAIL_NOT_CONFIRMED": "Hãy xác nhận email trước khi đăng nhập.",
    },
    en: {
        "errors.IDENTITY_UNAUTHENTICATED": "You need to sign in to do this.",
        "errors.IDENTITY_REFRESH_INVALID": "The session is invalid or has expired.",
        "errors.IDENTITY_REFRESH_REUSED": "The session ended because it was used again. Please sign in again.",
        "errors.IDENTITY_ACCOUNT_DISABLED": "This account is disabled.",
        "errors.IDENTITY_TOO_MANY_ATTEMPTS": "Too many attempts. Try again later.",
        "errors.IDENTITY_INVALID_CREDENTIALS": "The email or password is wrong.",
        "errors.IDENTITY_EMAIL_NOT_CONFIRMED": "Confirm your email before signing in.",
    },
}
