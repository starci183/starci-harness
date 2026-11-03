// Managed by starci app sync (slot be.identity.sign-in); do not edit: run "npx starci app sync --execute".
/** Log events of the sign-in decisions of identity; a line names an account by id, never by address, password or token. */
export enum IdentitySignInLogEvent {
    /** A first Google sign-in created an account. */
    AccountCreated = "identity.sign_in.account_created",
}
