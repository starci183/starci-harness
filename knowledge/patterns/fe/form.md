---
slots: [fe.hooks.rhf, fe.modules.toast, fe.components.providers]
---
# Forms and mutation feedback

How a form is built and submitted, and how the outcome of a write reaches the user.

## FE-FORM One form hook, bounds from the contract

A form is `hooks/rhf/use<X>Form.ts`: `useForm` with `zodResolver` over a zod schema built in `useMemo` with
translated messages, default values, and an `onSubmit` from `form.handleSubmit` that triggers the `useMutate<X>Swr`
hook through the toast runner. The connected half calls the hook and hands `XBase` resolved values and errors; the
pure half renders the grammar's fields.

Input bounds come from the back-end contract, never from copied numbers: codegen emits `INPUT_BOUNDS` (GraphQL input
directives) or `REST_INPUT_BOUNDS` (the OpenAPI DTO schema) with an `inputBoundsIssues` reader, exported by the API
owner. Each input object's schema calls `inputBoundsIssues` from `superRefine` and turns every returned path into a
translated issue; nested inputs compose their own refinement. Required fields, types and formats stay zod's; a
client rule may be stricter, never looser.

Why: one form shape keeps messages translated, submission tied to the mutation cache, and the limits equal to what
the back end enforces as soon as the contract changes.

Enforced by: R56, R286 FE_COPY_IN_CALL.

## FE-TOAST Every user-started write reports through the toast owner

`modules/toast` holds the grammar toast adapter, pure helpers (`showGraphQLToast` on a response's success flag,
`runGraphQLWithToast`, `runRestWithToast`) and the hooks `useGraphQLWithToast` and `useRestWithToast`, which inject the
toast namespace's labels. Every write a user starts runs through one of them; the message is the response message or
a catalog default. The grammar's toast region is mounted once in `components/providers`. Browser alerts are never used.

Why: one feedback path makes every success and failure visible the same way and keeps copy in the catalog.

Enforced by: R58, R286.
