import { ExternalLinkIcon } from 'lucide-preact';
import { useLocation } from 'preact-iso/router';
import { useEffect, useState } from 'preact/hooks';
import { Form, useActionState } from '../lib/actions.tsx';
import { AsyncButton } from '../ui/Button.tsx';
import Card from '../ui/Card.tsx';
import H2 from '../ui/H2.tsx';
import Input from '../ui/Input.tsx';
import Section from '../ui/Section.tsx';
import Stack, { VStack } from '../ui/Stack.tsx';
import AuthClient from '../user/AuthClient.ts';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { route } = useLocation();
  const { data: session } = AuthClient.useSession();

  // void's `router.flushAll()` drops its page-data cache before navigating;
  // preact-iso has no such cache, so navigating is all that's left.
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
          route('/', true);
        },
      },
    );

    return null;
  }, null);

  useEffect(() => {
    if (session) {
      route('/', true);
    }
  }, [route, session]);

  if (session) {
    return null;
  }

  return (
    <Section>
      <VStack center gap={16}>
        <H2 className="pl-5">Sign In</H2>
        <Stack gap={32} wrap>
          <Card className="w-84">
            <Stack gap vertical>
              <VStack action={signInAction} as={Form} gap={12}>
                <Input
                  className="w-48"
                  name="email"
                  onInput={(e) => setEmail(e.currentTarget.value)}
                  placeholder="email"
                  type="email"
                  value={email}
                />
                <Input
                  className="w-48"
                  name="password"
                  onInput={(e) => setPassword(e.currentTarget.value)}
                  placeholder="password"
                  type="password"
                  value={password}
                />
                <div>
                  <AsyncButton type="submit" variant="outline">
                    Sign In
                  </AsyncButton>
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
                href="https://github.com/nkzw-tech/fate/blob/main/example/seedData.ts#L1"
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
