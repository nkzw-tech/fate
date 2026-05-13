import { User } from '@app/server/src/router.ts';
import safeParse from '@nkzw/core/safeParse.js';
import Stack, { VStack } from '@nkzw/stack';
import { fbs } from 'fbtee';
import { ChangeEvent, useActionState, useState } from 'react';
import { view } from 'react-fate';
import { useFateClient } from 'react-fate';
import { ViewRef } from 'react-fate';
import { useView } from 'react-fate';
import { Button } from '../ui/Button.tsx';
import Card from '../ui/Card.tsx';
import AuthClient from '../user/AuthClient.tsx';
import H2 from './H2.tsx';
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
  const fate = useFateClient();
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
        optimistic: {
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
  const isSaveDisabled = !user.id || !trimmedName || trimmedName === originalName || isPending;

  return (
    <div>
      <VStack action={submitAction} as="form" gap={12}>
        <h3 className="font-semibold">
          <fbt desc="Headline for update name section">Update Name</fbt>
        </h3>
        <label className="sr-only" htmlFor="header-username">
          <fbt desc="Username label">Username</fbt>
        </label>
        <Input
          aria-describedby={error ? 'header-username-error' : undefined}
          aria-invalid={error ? 'true' : undefined}
          className="w-48"
          disabled={isPending}
          id="header-username"
          name="name"
          onChange={handleChange}
          placeholder={fbs('name', 'name input field placeholder')}
          title={error ?? undefined}
          value={name}
        />
        <div>
          <Button disabled={isSaveDisabled} size="sm" type="submit" variant="secondary">
            <fbt desc="Button for saving">Save</fbt>
          </Button>
        </div>
      </VStack>
      {error ? <span id="header-username-error">{error}</span> : null}
    </div>
  );
};

export default function UserCard({ user: userRef }: { user: ViewRef<'User'> }) {
  const user = useView(UserView, userRef);

  return (
    <Card>
      <VStack between className="h-full" gap={16}>
        <VStack gap={16}>
          <H2>
            <fbt desc="Your account headline">Your account</fbt>
          </H2>
          <Stack alignCenter between gap={16}>
            <p className="text-sm text-muted-foreground">
              <fbt desc="Signed in text">
                Signed in as <fbt:param name="username">{user.name}</fbt:param>.
              </fbt>
            </p>
          </Stack>
        </VStack>
        <UserNameForm user={user} />
      </VStack>
    </Card>
  );
}
