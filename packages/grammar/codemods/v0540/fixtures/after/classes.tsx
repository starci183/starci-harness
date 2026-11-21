export const Card = ({ title, total, hint, id }: Props) => (
    <section>
        <h1 className="starci-type-title-page">{title}</h1>
        <h2 className="starci-type-title-section">{title}</h2>
        <span className="starci-type-label-item text-foreground">{title}</span>
        <p className="starci-type-body text-muted">{hint}</p>
        <span className="starci-type-caption">{hint}</span>
        <span className="starci-type-label-group">{hint}</span>
        <label className="starci-type-label-field">{hint}</label>
        <span className="starci-type-figure tabular-nums">{total}</span>
        <code className="starci-type-code">{id}</code>
        <span /* TODO(type-role): responsive or state size variant */ className="md:text-sm">{hint}</span>
        <span /* TODO(type-role): xs without muted: caption or badge */ className="text-xs">{hint}</span>
    </section>
)
