---
slots: [fe.hooks.rhf, fe.modules.toast, fe.components.providers]
---
# Forms and mutation feedback

How a form is validated and submitted, and how the outcome of a write reaches the user.

## FE-FORM One form hook per form, with translated messages and contract bounds

A form is `hooks/rhf/use<X>Form.ts`: `useForm` with `zodResolver` over a zod schema built in `useMemo` from the
translator, with `values` or `defaultValues` from its caller; the connected half calls it, submits through
`form.handleSubmit` into a domain command hook, and hands `XBase` the watched values, the pending flag and the first
error message; the input bounds come from the generated `INPUT_BOUNDS` through `inputBoundsIssues` in `superRefine`,
never from a copied number.

Why: one form shape keeps messages translated and submission tied to the command that owns the write, and contract
bounds change with the back end instead of drifting from it.

```ts
/** The display-name form; the bounds are the back end's, read from the generated contract. */
export const useProfileForm = (name: string) => {
    const t = useTranslations("account")
    const schema = useMemo(
        () => z.object({ name: z.string().trim() }).superRefine((value, ctx) => {
            for (const issue of inputBoundsIssues(INPUT_BOUNDS.UpdateProfileInput, value)) {
                ctx.addIssue({ code: "custom", path: [...issue.path], message: t("errName") })
            }
        }),
        [t],
    )
    return useForm<ProfileValues>({ resolver: zodResolver(schema), values: { name }, mode: "onSubmit" })
}
```

Enforced by: R56 (`hooks-folder-holds-hooks-only`), R286 (`no-copy-in-call`); the contract bounds are review only.

## FE-TOAST Every user-started write reports through `modules/toast`

`modules/toast` holds the grammar toast adapter (`toast.tsx`), the pure runners (`api.ts`: `runGraphQLWithToast`,
`runRestWithToast`, `showGraphQLToast`) and the hooks that inject the toast namespace's copy (`hooks.ts`:
`useGraphQLWithToast`, `useRestWithToast`); every write a user starts runs through one of the hooks, the region is
mounted once by the providers, and `alert()` is never used.

Why: one feedback path makes every success and failure visible the same way and keeps its copy in the catalog.

Enforced by: R286 (`no-alert`, `no-copy-in-call`), R55 (`use-client-only-at-boundary`).
