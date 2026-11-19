# Type scale: no raw font in an app

Grammar owns the console type scale (`contexts/ui/presentation.md` FONT-7a and FONT-7b): title 18 / 26 / 500, heading 16 / 24 / 500, label 16 / 24 / 400, body 14 / 20 / 400, meta 12 / 16 / 400, weights 400 and 500 only. An app gets them through components (`Text`, `Heading`, `Section`, list and row parts), so it never sets a size, weight, style or case.

`starci-fe/no-raw-font` reports:

- a Tailwind utility that sets type in a `className` (or in `cn`, `clsx`, `cva`, `twMerge`): `text-xs` to `text-9xl`, `text-[15px]`, `font-medium`, `font-bold`, `font-[600]`, `italic`, `uppercase`, `lowercase`, `capitalize`, `leading-*`, `tracking-*`, with any variant prefix;
- an inline `style` with `fontSize`, `fontWeight`, `fontFamily`, `fontStyle`, `lineHeight`, `letterSpacing` or `textTransform`.

It leaves text colour (`text-foreground`), alignment, truncation (`truncate`, `line-clamp-*`) and `font-mono` alone.
