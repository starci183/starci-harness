import { Code } from "@starci/grammar/core"
import { COMMON } from "./labels"

/** Keys (Op keys, dependencies) as inline code, comma separated, or the word for none. */
export const KeyList = ({ keys }: { readonly keys: readonly string[] }) =>
    keys.length === 0 ? (
        COMMON.none
    ) : (
        <>
            {keys.map((key, index) => (
                <span key={key}>
                    {index === 0 ? null : ", "}
                    <Code>{key}</Code>
                </span>
            ))}
        </>
    )
