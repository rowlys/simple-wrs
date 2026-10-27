import { Button, Center, Paper, PasswordInput, Stack, TextInput, Title } from '@mantine/core';
import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { ErrorAlert } from '../components/ErrorAlert';

export function LoginPage() {
  const { user, login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);

  // AC-01.1: after login (or when already logged in) the receiving document list.
  if (user) return <Navigate to="/receiving" replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      await login(username, password);
    } catch (e) {
      setError(e);
      setPending(false);
    }
  }

  return (
    <Center mih="100vh" p="md">
      <Paper withBorder shadow="sm" p="xl" w={360}>
        <form onSubmit={submit}>
          <Stack>
            <Title order={2}>Warehouse Receiving</Title>
            <ErrorAlert error={error} />
            <TextInput label="Username" value={username} onChange={(e) => setUsername(e.currentTarget.value)} required maxLength={50} autoFocus />
            <PasswordInput label="Password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} required maxLength={100} />
            <Button type="submit" loading={pending}>
              Log in
            </Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}
