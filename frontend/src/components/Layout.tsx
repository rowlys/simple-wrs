import { AppShell, Badge, Burger, Button, Group, NavLink, Text, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { NavLink as RouterNavLink, Outlet } from 'react-router';
import { useAuth, useCurrentUser } from '../auth/AuthProvider';

const LINKS: { to: string; label: string; end?: boolean }[] = [{ to: '/receiving', label: 'Receiving' }];

export function Layout() {
  const user = useCurrentUser();
  const { logout } = useAuth();
  const [opened, { toggle, close }] = useDisclosure();

  return (
    // The navbar collapses below Mantine's sm breakpoint (48em = 768 px, NFR-06).
    <AppShell header={{ height: 56 }} navbar={{ width: 200, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Menu" />
            <Title order={4}>Warehouse Receiving</Title>
          </Group>
          <Group gap="sm" wrap="nowrap">
            <Text size="sm" visibleFrom="xs">
              {user.fullName}
            </Text>
            <Badge variant="light">{user.role}</Badge>
            <Button variant="default" size="xs" onClick={logout}>
              Log out
            </Button>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs">
        {LINKS.map(({ to, label, end }) => (
          <NavLink key={to} component={RouterNavLink} to={to} end={end} label={label} onClick={close} />
        ))}
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
