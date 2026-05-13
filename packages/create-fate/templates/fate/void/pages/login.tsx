import Stack, { VStack } from '@nkzw/stack';
import { useRouter, useShared } from '@void/react';
import { ExternalLinkIcon } from 'lucide-react';
import { useActionState, useEffect, useState } from 'react';
import type { SharedData } from '../src/lib/shared.ts';
import { Button } from '../src/ui/Button.tsx';
import Card from '../src/ui/Card.tsx';
import H2 from '../src/ui/H2.tsx';
import Input from '../src/ui/Input.tsx';
import Section from '../src/ui/Section.tsx';
import AuthClient from '../src/user/AuthClient.tsx';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const router = useRouter();
  const { auth } = useShared<SharedData>();

  const [, signInAction] = useActionState(async () => {
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

    return null;
  }, null);

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
    <Section>
      <VStack center gap={16}>
        <H2 className="pl-5">Sign In</H2>
        <Stack gap={32} wrap>
          <Card className="w-84">
            <Stack gap vertical>
              <VStack action={signInAction} as="form" gap={12}>
                <Input
                  className="w-48"
                  name="email"
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="email"
                  type="email"
                  value={email}
                />
                <Input
                  className="w-48"
                  name="password"
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
                href="https://github.com/nkzw-tech/fate/blob/main/packages/create-fate/templates/fate/void/seedData.ts#L1"
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
    </Section>
  );
}
