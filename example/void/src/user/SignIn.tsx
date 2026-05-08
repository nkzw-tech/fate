import Stack, { VStack } from '@nkzw/stack';
import { useRouter, useShared } from '@void/react';
import { ExternalLinkIcon } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import type { SharedData } from '../lib/shared.ts';
import { Button } from '../ui/Button.tsx';
import Card from '../ui/Card.tsx';
import H2 from '../ui/H2.tsx';
import Input from '../ui/Input.tsx';
import AuthClient from './AuthClient.tsx';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const router = useRouter();
  const { auth } = useShared<SharedData>();

  const signIn = async (event: FormEvent) => {
    event.preventDefault();

    await AuthClient.signIn.email(
      {
        email,
        password,
      },
      {
        onError: () => {},
        onRequest: () => {},
        onSuccess: () => {
          router.flushAll();
          void router.visit('/', { replace: true });
        },
      },
    );
  };

  useEffect(() => {
    if (auth.user) {
      router.flushAll();
      void router.visit('/', { replace: true });
    }
  }, [auth.user, router]);

  if (auth.user) {
    return null;
  }

  return (
    <VStack center gap={16}>
      <H2 className="pl-5">Sign In</H2>
      <Stack gap={32} wrap>
        <Card className="w-84">
          <Stack gap vertical>
            <VStack as="form" gap={12} onSubmit={signIn}>
              <Input
                className="w-48"
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email"
                type="email"
                value={email}
              />
              <Input
                className="w-48"
                onChange={(e) => setPassword(e.target.value)}
                placeholder="password"
                type="password"
                value={password}
              />
              <div>
                <Button type="submit" variant="outline">
                  Sign In
                </Button>
              </div>
            </VStack>
          </Stack>
        </Card>
        <Card className="w-84">
          <p>
            Try one of the
            <Stack
              alignCenter
              as="a"
              className="inline-flex! px-1 underline hover:no-underline"
              gap={4}
              href="https://github.com/nkzw-tech/fate/blob/main/example/server-prisma/src/prisma/seed.tsx#L7"
              rel="noreferrer"
              target="_blank"
            >
              Example Accounts
              <ExternalLinkIcon className="h-4 w-4" />
            </Stack>{' '}
            in the seed data.
          </p>
        </Card>
      </Stack>
    </VStack>
  );
}
