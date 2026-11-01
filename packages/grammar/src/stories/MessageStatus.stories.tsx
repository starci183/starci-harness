import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import * as G from "../common/index.js"
import { MessageStatus, type MessageStatusProps } from "../core/composite/MessageStatus/index.js"
import { Matrix, State } from "./fixtures.js"

const meta: Meta = { title: "Compositions/Message delivery" }
export default meta
type Story = StoryObj

const receipts: ReadonlyArray<MessageStatusProps> = [
    { kind: "receipt", state: "sent", label: "Sent" },
    { kind: "receipt", state: "delivered", label: "Delivered" },
    { kind: "receipt", state: "seen", label: "Seen" },
    { kind: "receipt", state: "seen", label: "Seen by the team", readers: {
        items: [
            { id: "reader-alex", name: "Alex Morgan" },
            { id: "reader-sam", name: "Sam Lee" },
            { id: "reader-linh", name: "Linh Nguyen" },
            { id: "reader-robin", name: "Robin Chen" },
        ],
        overflowLabel: "1 more reader",
        moreLabel: "2 additional readers",
    } },
]
const fallbackReceipt: MessageStatusProps = { kind: "receipt", state: "sent", label: "Sent" }
const unknownDelivery: MessageStatusProps = { kind: "transport", state: "unknown", label: "The delivery result is unknown. Check the channel before resending; this message will not be resent automatically." }
const deliveries: ReadonlyArray<MessageStatusProps> = [
    { kind: "transport", state: "queued", label: "Queued for delivery" },
    { kind: "transport", state: "sent", label: "Sent to the customer" },
    { kind: "transport", state: "failed", label: "The channel rejected this message. Review the connection before trying again." },
    unknownDelivery,
]

/** Every message receipt and transport outcome, with readable labels independent of colour. */
export const NativeStates: Story = {
    render: () => <Matrix maxWidth={640}>
        {receipts.map((receipt, index) => <State key={index} label={`Receipt: ${receipt.state}${receipt.kind === "receipt" && receipt.state === "seen" && receipt.readers ? " with readers" : ""}`} direction="column">
            <G.MessageBubble side="outgoing" meta="09:14" body="The meeting has moved to Friday." footer={<MessageStatus {...receipt} />} />
        </State>)}
        {deliveries.map((delivery) => <State key={delivery.state} label={`Transport: ${delivery.state}`} direction="column">
            <G.MessageBubble side="outgoing" meta="09:15" body="Your order is ready for collection." footer={<MessageStatus {...delivery} />} />
        </State>)}
        <State label="Attachments stay above the delivery note" direction="column">
            <G.MessageBubble side="outgoing" body="Here is the document." footer={<G.Stack gap="identity"><G.Text>order-summary.pdf</G.Text><MessageStatus {...unknownDelivery} /></G.Stack>} />
        </State>
    </Matrix>,
}

const ReceiptUpdates = () => {
    const [index, setIndex] = useState(0)
    return <G.Stack gap="row">
        <G.MessageBubble side="outgoing" body="Can you confirm the new time?" footer={<MessageStatus {...(receipts[index] ?? fallbackReceipt)} />} />
        <G.Button intent="neutral" onPress={() => setIndex((current) => (current + 1) % receipts.length)}>Show the next receipt</G.Button>
    </G.Stack>
}

/** A changing receipt retains its polite atomic announcement and native mark. */
export const ReceiptChanges: Story = { render: () => <Matrix><State label="Sent → delivered → seen" direction="column"><ReceiptUpdates /></State></Matrix> }
