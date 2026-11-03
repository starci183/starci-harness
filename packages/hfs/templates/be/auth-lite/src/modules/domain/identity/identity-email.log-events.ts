// Managed by starci app sync (slot be.identity.sign-in); do not edit: run "npx starci app sync --execute".
/** Log events owned by the email doors of sign-in. */
export enum IdentityEmailLogEvent {
    /** A confirmation or reset mail could not be sent; the door still answers as if it was, so an address is never confirmed or denied. */
    MailFailed = "identity.email.mail_failed",
}
