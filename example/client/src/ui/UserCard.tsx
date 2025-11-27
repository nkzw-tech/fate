import safeParse from '@nkzw/core/safeParse.js';
import { User } from '@nkzw/fate-server/src/trpc/router.ts';
import Stack, { VStack } from '@nkzw/stack';
import { ChangeEvent, useActionState, useState } from 'react';
import { view } from 'react-fate';
import { fate } from '../lib/fate.tsx';
import { Button } from '../ui/Button.tsx';
import Card from '../ui/Card.tsx';
import H3 from '../ui/H3.tsx';
import AuthClient from '../user/AuthClient.tsx';
import Input from './Input.tsx';

export type SessionUser = {
  id?: string | null;
  name?: string | null;
  username?: string | null;
};

export const UserView = view<User>()({
  id: true,
  name: true,
  username: true,
});

const UserNameForm = ({ user }: { user: SessionUser }) => {
  const [name, setName] = useState(user.name ?? '');
  const [error, setError] = useState<string | null>(null);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setName(event.target.value);
  };

  const [, submitAction, isPending] = useActionState(async () => {
    const id = user?.id;
    if (!id) {
      return;
    }

    const newName = name.trim();
    setName(newName);

    if (newName === user.name) {
      setError(null);
      return;
    }

    try {
      setError(null);
      await fate.mutations.user.update({
        input: { name: newName },
        optimisticUpdate: {
          id,
          username: newName,
        },
        view: UserView,
      });
      await AuthClient.updateUser({ name });
    } catch (error) {
      setError(
        (error instanceof Error &&
          error.message &&
          safeParse<Array<{ message: string }>>(error.message)?.[0]?.message) ||
          'Failed to update user name.',
      );
    }
  }, null);

  const trimmedName = name.trim();
  const originalName = user.name ?? '';
  const isSaveDisabled =
    !user.id || !trimmedName || trimmedName === originalName || isPending;

  return (
    <div>
      <form action={submitAction} className="flex items-center gap-2">
        <label className="sr-only" htmlFor="header-username">
          Username
        </label>
        <Input
          aria-describedby={error ? 'header-username-error' : undefined}
          aria-invalid={error ? 'true' : undefined}
          disabled={isPending}
          id="header-username"
          name="name"
          onChange={handleChange}
          placeholder="Name"
          title={error ?? undefined}
          value={name}
        />
        <Button
          disabled={isSaveDisabled}
          size="sm"
          type="submit"
          variant="secondary"
        >
          Save
        </Button>
      </form>
      {error ? <span id="header-username-error">{error}</span> : null}
    </div>
  );
};

export default function UserCard({ user }: { user: SessionUser | null }) {
  return user ? (
    <Card>
      <VStack gap={4}>
        <H3>Your account</H3>
        <Stack alignCenter between gap={16}>
          <p className="text-muted-foreground text-sm">
            Welcome back{user.name ? `, ${user.name}` : ''}.
          </p>
          <UserNameForm user={user} />
        </Stack>
      </VStack>
    </Card>
  ) : null;
}
