import type { LeadBoardBlockBaseProps } from "@/components/blocks/LeadBoardBlock/component"

/** The status copy every slot of the stories shows. */
const SLOT_LABELS = { empty: "No leads yet", error: "The leads could not load", forbidden: "You cannot see these leads", retry: "Try again" }

/** The ready args of the lead board, both reads settled with items; a story overrides the shape or a slot. */
export const LEAD_BOARD_ARGS: LeadBoardBlockBaseProps = {
    shape: "list",
    props: {
        title: "Leads",
        ownersTitle: "Owners on duty",
        shapeLabels: { list: "All", stages: "By stage", unassigned: "Unowned" },
        leads: {
            items: [
                { id: "lead-1", name: "Hoa Nguyen", stage: "new" },
                { id: "lead-2", name: "Minh Tran", stage: "contacted", ownerName: "Lan" },
                { id: "lead-3", name: "An Pham", stage: "qualified", ownerName: "Duc" },
            ],
        },
        owners: { items: [{ id: "owner-1", name: "Lan" }, { id: "owner-2", name: "Duc" }] },
        leadsLabels: SLOT_LABELS,
        ownersLabels: SLOT_LABELS,
    },
    on: { show: () => undefined, retryLeads: () => undefined, retryOwners: () => undefined },
}
