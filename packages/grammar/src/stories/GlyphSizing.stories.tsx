import type { Meta, StoryObj } from '@storybook/react-vite';
import * as G from '../common/index.js';

/**
 * Outline glyphs inside vendor slots (0.37.5): the Select chevron, the search icon and the number steppers are sized by the Icon usage box and never stretch to their
 * slot (0.37.4 shipped them with no size, and a chevron filled a whole search row). A Select, a SearchField and a NumberField stand in a section's filter row and every svg is a 16px glyph.
 */
const meta: Meta = { title: 'Surfaces/Glyph sizing' };
export default meta;
type Story = StoryObj;

const OPTIONS = [
  { id: 'all', label: 'All' },
  { id: 'paid', label: 'Paid' },
];

export const InSectionFilter: Story = {
  render: () => (
    <div style={{ width: 'min(100%, 720px)' }}>
      <G.Section
        title="Orders"
        filter={(
          <>
            <G.SearchField label="Search orders" isLabelHidden placeholder="Search orders" clearLabel="Clear search" />
            <G.Select label="Status" isLabelHidden options={OPTIONS} defaultValue="all" />
            <G.NumberField label="Quantity" isLabelHidden defaultValue={1} />
          </>
        )}
      >
        <G.DataTable
          label="Orders"
          columns={[{ id: 'order', label: 'Order' }]}
          rows={[{ id: 'a' }]}
          renderCell={() => 'DH-1001'}
          emptyContent={<G.EmptyNotice message="Empty" />}
        />
      </G.Section>
    </div>
  ),
};
