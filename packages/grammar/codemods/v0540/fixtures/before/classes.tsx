export const Card = ({ title, total, hint, id }: Props) => (
    <section>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <h2 className="text-base font-medium">{title}</h2>
        <span className="text-sm font-medium text-foreground">{title}</span>
        <p className="text-sm text-muted">{hint}</p>
        <span className="text-xs text-muted">{hint}</span>
        <span className="text-xs font-medium text-muted">{hint}</span>
        <label className="text-sm font-medium text-muted">{hint}</label>
        <span className="text-2xl tabular-nums">{total}</span>
        <code className="text-xs font-mono">{id}</code>
        <span className="md:text-sm">{hint}</span>
        <span className="text-xs">{hint}</span>
    </section>
)
