import { DISPLAY, EYEBROW, SUB, TITLE } from "./classNames"

export const SiteHead = (props: SiteHeadProps) => {
    const Title = props.level === 1 ? "h1" : "h2"
    return (
        <div>
            <p className={EYEBROW}>{props.eyebrow}</p>
            <Title className={props.level === 1 ? DISPLAY : TITLE}>{props.title}</Title>
            <p className={SUB}>{props.sub}</p>
        </div>
    )
}
