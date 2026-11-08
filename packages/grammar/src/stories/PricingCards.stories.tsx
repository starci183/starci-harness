import type { Meta, StoryObj } from '@storybook/react-vite';
import { CheckCircleIcon } from '@heroicons/react/24/outline';
import * as G from '../common/index.js';

const meta: Meta = { title: 'Surfaces/Pricing cards', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

const PLANS = [
  { id: 'pro', name: 'Pro', price: '990.000 ₫/month', features: ['Up to 2 people', '2,000 AI credits a month'] },
  { id: 'max', name: 'Max', price: '2.490.000 ₫/month', features: ['Up to 5 people', '8,000 AI credits a month'], popular: true },
  { id: 'ultra', name: 'Ultra', price: '4.990.000 ₫/month', features: ['Up to 15 people', '24,000 AI credits a month'] },
] as const;

/** A pricing grid: the leading value of each card at the figure size (FONT-5), the recommended plan with the accent ring and a badge, steps finished with a check. */
export const PricingGrid: Story = {
  render: () => (
    <G.Stack gap="region">
      <G.Stepper
        label="Create a workspace"
        currentStepId="plan"
        completeMarker="check"
        steps={[
          { id: 'business', label: 'Business' },
          { id: 'channels', label: 'Channels' },
          { id: 'ai', label: 'Hand to AI' },
          { id: 'plan', label: 'Plan' },
        ]}
      />
      <G.Grid kind="cards" columns={3}>
        {PLANS.map((plan) => (
          <G.SurfaceCard
            key={plan.id}
            ariaLabel={plan.name}
            {...('popular' in plan ? { emphasis: 'accent' as const } : {})}
            headers={[
              {
                kind: 'custom',
                children: (
                  <G.Stack gap="row">
                    <G.Cluster gap="inline" justify="between">
                      <G.Heading level={2}>{plan.name}</G.Heading>
                      {'popular' in plan ? <G.Badge tone="accent">Most popular</G.Badge> : null}
                    </G.Cluster>
                    <G.Text size="figure">{plan.price}</G.Text>
                    <G.Button intent={'popular' in plan ? 'commit' : 'neutral'} width="fill">{`Choose ${plan.name}`}</G.Button>
                  </G.Stack>
                ),
              },
            ]}
          >
            <G.Stack gap="row">
              {plan.features.map((feature) => (
                <G.Text key={feature} size="sm" startContent={<G.Icon source={CheckCircleIcon} usage="leading" />}>{feature}</G.Text>
              ))}
            </G.Stack>
          </G.SurfaceCard>
        ))}
      </G.Grid>
    </G.Stack>
  ),
};
