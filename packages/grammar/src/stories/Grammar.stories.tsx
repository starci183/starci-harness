import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Badge,
  Button,
  Divider,
  EmptyNotice,
  Heading,
  Input,
  Page,
  TopBar,
  SurfaceCard,
  type ListRowData,
  Text,
  Link,
  WorkspaceShell,
} from '../common/index.js';
import turtleUrl from './assets/turtle.png';

/**
 * Reference renders of the shipped Common anatomy in the `core` family,
 * composed into the screen shapes the todo directions target. Direction
 * generation cites these pixels as the anatomy source — component look is
 * never invented from a name.
 */

const meta: Meta = {
  title: 'Grammar/Core anatomy',
  // Pinned to Core with a consumer accent override. The reference renders were captured with
  // #2F6BFF; white on it is 4.49:1, one hair under AA, so the override is the nearest AA-safe
  // blue (#2F69FF, 4.58:1 with the white accent foreground).
  globals: { grammarFamily: 'core' },
  parameters: {
    layout: 'fullscreen',
    grammar: { bleed: true, rootStyle: { ['--starci-core-accent' as string]: '#2F69FF' } },
  },
};
export default meta;

type Story = StoryObj;

// The primary destinations are a named `<nav>` the app draws; TopBar holds it in its row.
const navDestinations = (
  <div style={{ display: 'flex', gap: '1.5rem' }}>
    <a href="#" aria-current="page">Tasks</a>
    <a href="#">Notifications</a>
    <a href="#">Plan</a>
    <a href="#">Privacy</a>
  </div>
);

const topNav = (
  <TopBar
    brand={<strong>Todo app</strong>}
    navigation={<nav aria-label="Primary">{navDestinations}</nav>}
    menu={{ icon: <span>Menu</span>, openLabel: "Open navigation", closeLabel: "Close navigation", isOpen: false, onOpenChange: () => undefined }}
    actions={
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <span aria-hidden="true">A</span>
        <span>Alex</span>
        <Link href="#" variant="plain">Sign out</Link>
      </div>
    }
  />
);

const pageFooter = (
  <div style={{ display: 'flex', gap: '1rem', padding: '1.5rem 0', color: 'var(--muted, #555)' }}>
    <Link href="#" variant="plain">Privacy policy</Link>
    <Link href="#" variant="plain">Terms</Link>
  </div>
);

/** Full auth composition: brand illustration left, form card right — the split the brand record rules. */
export const SignInScreen: Story = {
  name: 'Sign-in (split-screen composition)',
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: '100vh' }}>
      <section
        aria-label="About Todo app"
        style={{
          background: 'var(--surface-secondary, #f3f4f6)',
          display: 'flex',
          flexDirection: 'column',
          padding: '3rem',
          gap: '1.5rem',
        }}
      >
        <strong>Todo app</strong>
        <div>
          <Heading level={1}>A steady start.</Heading>
          <Text tone="muted">One task at a time.</Text>
        </div>
        <img src={turtleUrl} alt="Todo app turtle mascot" style={{ maxWidth: 420, marginTop: 'auto' }} />
      </section>
      <section style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '3rem' }}>
        <div style={{ maxWidth: 400, width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div>
            <Heading level={1}>Welcome back</Heading>
            <Text tone="muted">Sign in to keep your tasks moving.</Text>
          </div>
          <form style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <Input id="email" name="email" label="Email" kind="email" defaultValue="alex@example.test" />
            <div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.25rem' }}>
                <Link href="#" variant="plain">Forgot password?</Link>
              </div>
              <Input id="password" name="password" label="Password" kind="password" placeholder="Enter your password" />
            </div>
            <Text live="assertive">We couldn&apos;t sign you in. Check your email and password.</Text>
            <Button type="submit" intent="commit" width="fill">Sign in</Button>
            <Text>New here? <Link href="#">Create an account</Link></Text>
          </form>
          <div style={{ marginTop: 'auto', display: 'flex', gap: '1rem' }}>
            <Link href="#" variant="plain">Privacy policy</Link>
            <Link href="#" variant="plain">Terms of service</Link>
          </div>
        </div>
      </section>
    </div>
  ),
};

const taskRow = (title: string, done: boolean): ListRowData => ({
  id: title,
  title,
  ...(done ? { state: 'affirmative' as const } : {}),
  action: { label: 'Delete', press: () => undefined },
});

/** Full tasks screen: shell + composer card + collection card — the anatomy the direction maps. */
export const TasksScreen: Story = {
  name: 'Tasks (shell + composer + list card)',
  render: () => (
    <WorkspaceShell
      header={topNav}
      primaryLabel="Tasks"
      primary={
        <Page>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div>
              <Heading level={1}>Your tasks</Heading>
              <Text tone="muted">A little progress, every day.</Text>
            </div>
            <SurfaceCard ariaLabel="New task">
              <form style={{ display: 'flex', gap: '0.75rem', alignItems: 'end' }}>
                <div style={{ flex: 1 }}>
                  <Input id="new-task" name="title" label="New task" placeholder="What needs doing?" />
                </div>
                <Button type="submit" intent="commit">Add task</Button>
              </form>
            </SurfaceCard>
            <SurfaceCard
              kind="list"
              label="All tasks"
              headingLevel={2}
              fact="4 tasks"
              note={<Text tone="muted">Completed tasks stay here until you delete them.</Text>}
              empty={<EmptyNotice message="No tasks yet." />}
              items={[
                taskRow('Plan the week', false),
                taskRow('Send the project update', false),
                taskRow('Book the bike repair', false),
                taskRow('Water the plants', true),
              ]}
            />
            {pageFooter}
          </div>
        </Page>
      }
    />
  ),
};

/** Leaf inventory: the palette, type and action leaves every direction region maps to. */
export const Leaves: Story = {
  name: 'Leaves (button, input, text, action)',
  render: () => (
    <Page>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: 560 }}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <Button intent="commit">Primary</Button>
          <Button intent="alternative">Secondary</Button>
          <Button intent="dismiss">Tertiary</Button>
          <Button intent="neutral">Outline</Button>
          <Button intent="neutral">Ghost</Button>
          <Button intent="commit" isPending>Pending</Button>
          <Button intent="commit" isDisabled>Disabled</Button>
        </div>
        <Divider label="or" />
        <Input id="i1" name="a" label="Email" kind="email" placeholder="you@example.com" />
        <Input id="i2" name="b" label="On a surface — secondary" kind="text" placeholder="secondary field" />
        <Input id="i3" name="c" label="With error" isInvalid errorMessage="This value is not accepted." defaultValue="bad input" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <Heading level={2}>Heading</Heading>
          <Text>Default body text.</Text>
          <Text tone="muted">Muted supporting text.</Text>
          <Text><Link href="#">Link</Link> beside copy.</Text>
          <Badge>Badge</Badge>
        </div>
      </div>
    </Page>
  ),
};

export const EmptyState: Story = {
  name: 'EmptyNotice (no tasks)',
  render: () => (
    <WorkspaceShell
      header={topNav}
      primaryLabel="Tasks"
      primary={
        <Page>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div>
              <Heading level={1}>Your tasks</Heading>
              <Text tone="muted">A little progress, every day.</Text>
            </div>
            <SurfaceCard
              kind="list"
              label="All tasks"
              headingLevel={2}
              fact="0 tasks"
              items={[]}
              empty={<EmptyNotice message="No tasks yet." description="Add the first one above." />}
            />
          </div>
        </Page>
      }
    />
  ),
};
