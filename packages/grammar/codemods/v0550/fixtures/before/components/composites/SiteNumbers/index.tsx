import { Text } from "@starci/grammar/common"
import { AMOUNT, BIG, ITEM, LABEL, NAME, NUMBER, STEP, TITLE } from "./classNames"

export const SiteNumbers = (props: SiteNumbersProps) => (
    <div>
        <span className={NUMBER}>{props.count}</span>
        <p className={AMOUNT}>{props.price}</p>
        <h3 className={TITLE}>{props.title}</h3>
        <h3 className={NAME}>{props.name}</h3>
        <span className={LABEL}>{props.label}</span>
        <li className={ITEM}>{props.item}</li>
        <span className={STEP}>{props.step}</span>
        <p className={BIG}>{props.big}</p>
        <Text size="sm" isStrong tone="muted">
            {props.note}
        </Text>
        <Text size={props.size}>{props.note}</Text>
    </div>
)
