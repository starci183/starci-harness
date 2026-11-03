# Changelog

## 0.1.0 - 2026-11-03

Outgoing mail for a StarCi back end in one package, lifted from the mail integrations of the apps that each wrote one (Nivo's `integrations/mail`, the academy's mailer, the older Nest mailer modules) and generalised: no product names, every setting a typed option, no environment read, no template engine.

- Added: `MailModule.register` / `registerAsync` (with `isGlobal`) providing the `Mailer` port under `MAILER`, and `createMailer` for plain Node.
- Added: `Mailer.send({ to, message, from?, replyTo? })` over SMTP (nodemailer): STARTTLS required by default, implicit TLS or a plain local sink on request, certificates verified, connect, greeting and socket timeouts plus a total send timeout, a refused recipient rejecting the send.
- Added: recipient, sender and message checks before any connection (plain mailboxes, one-line subject, text body, size and recipient limits, no header injection).
- Added: coded errors (`MAIL_AUTH`, `_APP_PASSWORD`, `_CONNECT`, `_TIMEOUT`, `_DNS`, `_TLS`, `_SENDER`, `_RECIPIENT`, `_LIMIT`, `_UNKNOWN`, `_ADDRESS_INVALID`, `_MESSAGE_INVALID`) with the kind each travels as, classified from nodemailer and SMTP failures.
- Added: typed render helpers: the `html` tag (escapes every interpolation), `escapeHtml`, `raw`, `safeUrl`, `oneLine` and `renderTransactional` returning `{ subject, text, html }`.
- Added: `@starci/mail/testing`: `createMemoryMailer` (the real checks over an in-memory outbox with `to`, `lastTo`, the first `link` of a message and `failNext`), `mailTestingModule`, `testMailOptions`.
- The package is the only owner of `nodemailer`.
